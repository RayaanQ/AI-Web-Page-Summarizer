from fastapi import FastAPI, HTTPException, BackgroundTasks,Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal, List, Dict, Any
import os
from dotenv import load_dotenv
import google.generativeai as genai
import logging
import uuid
from datetime import datetime, timedelta
from langchain.chat_models import init_chat_model
from session_manager import SessionManager

# Additional libraries for RAG and media extraction
from langchain_community.tools import TavilySearchResults
from langchain_community.document_loaders import PyPDFLoader, YoutubeLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain.embeddings import OpenAIEmbeddings
from langchain.schema import Document
import requests
from urllib.parse import urljoin, urlparse
import re
import asyncio
import concurrent.futures
import tempfile
from pdf2image import convert_from_path
import os
from PIL import Image
import pytesseract
import whisper  # For video transcription
import yt_dlp  # For video extraction
import youtube_dl
import hashlib
from models import *

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI WebPage Chatbot API with RAG",
    description="API for interactive Q&A with webpage content using AI and RAG",
    version="3.0.0"
)

# Configured this to not get CORS error
app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize session manager
session_manager = SessionManager()

# Using Gemini LLM here for our responses through the langchain setup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")  # Tavily API key as search engine(RAG)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # For whisper video extraction embeddings(Fallback mechainisms if one method doesnt work)

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set")
if not TAVILY_API_KEY:  
    logger.warning("TAVILY_API_KEY not set, RAG search disabled")
if not OPENAI_API_KEY:  
    logger.warning("OPENAI_API_KEY not set, using alternative embeddings")

os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY
if TAVILY_API_KEY:
    os.environ["TAVILY_API_KEY"] = TAVILY_API_KEY

gemini_model = init_chat_model("gemini-2.5-flash", model_provider="google_genai")

# Tavily internal feature settings
tavily_tool = None
if TAVILY_API_KEY:
    try:
        tavily_tool = TavilySearchResults(
            max_results=5,
            search_depth="advanced",
            include_raw_content=True
        )
    except Exception as e:
        logger.error(f"Failed to initialize Tavily: {e}")

# Initialize embeddings (fallback to sentence transformers if OpenAI not available)
try:
    if OPENAI_API_KEY:
        embeddings = OpenAIEmbeddings()
    else:
        from langchain_community.embeddings import HuggingFaceEmbeddings
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
except Exception as e:
    logger.warning(f"Failed to initialize embeddings: {e}")
    embeddings = None

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    length_function=len
)

# Initialize Whisper model for audio transcription (optional fallback mechanism)
whisper_model = None
try:
    whisper_model = whisper.load_model("base")
    logger.info("Whisper model loaded successfully")
except Exception as e:
    logger.warning(f"Failed to load Whisper model: {e}")

# Global cache for Tavily search results per session
tavily_cache = {}

# This js the Media extraction class
class MediaExtractor:
    """Extract content from various media types"""
    
    @staticmethod
    def extract_pdf_from_url(pdf_url: str) -> str:
        """Extract text from PDF URL"""
        try:
            logger.info(f"Attempting to extract PDF from: {pdf_url}")
            
            # We create temporary file first
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_file:
                response = requests.get(pdf_url, timeout=30, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                response.raise_for_status()
                tmp_file.write(response.content)
                tmp_file.flush()
                
                logger.info(f"Downloaded PDF to temporary file: {tmp_file.name}")
                
                # Then we try PyPDFLoader next as the first thing
                try:
                    loader = PyPDFLoader(tmp_file.name)
                    pages = loader.load()
                    text = "\n".join([page.page_content for page in pages]).strip()
                    logger.info(f"PyPDFLoader extracted {len(text)} characters")
                except Exception as e:
                    logger.warning(f"PyPDFLoader failed: {e}, trying OCR fallback")
                    text = ""
                
                # If no text or very little text, we try OCR
                if len(text) < 100:
                    try:
                        logger.info("Attempting OCR extraction from PDF")
                        from pdf2image import convert_from_path
                        images = convert_from_path(tmp_file.name, dpi=150)
                        ocr_text = ""
                        for i, image in enumerate(images[:10]):  # Limit to first 10 pages
                            page_text = pytesseract.image_to_string(image, lang='eng')
                            if page_text.strip():
                                ocr_text += f"\n--- Page {i+1} ---\n{page_text.strip()}\n"
                        text = ocr_text.strip()
                        logger.info(f"OCR extracted {len(text)} characters")
                    except Exception as ocr_e:
                        logger.error(f"OCR extraction failed: {ocr_e}")
                
                # Clean up temporary file
                try:
                    os.unlink(tmp_file.name)
                except:
                    pass
                
                if not text or len(text) < 50:
                    logger.warning(f"PDF extraction produced insufficient text: {len(text)} characters")
                    return ""
                else:
                    logger.info(f"Successfully extracted {len(text)} characters from PDF")
                    return text
                    
        except Exception as e:
            logger.error(f"PDF extraction error for {pdf_url}: {str(e)}")
            return ""
    
    @staticmethod
    def extract_text_from_image_url(image_url: str) -> str:
        """Extract text from image URL using OCR"""
        try:
            logger.info(f"Attempting OCR on image: {image_url}")
            
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_file:
                response = requests.get(image_url, timeout=30, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                response.raise_for_status()
                tmp_file.write(response.content)
                tmp_file.flush()
                
                # Use pytesseract for OCR
                image = Image.open(tmp_file.name)
                text = pytesseract.image_to_string(image, lang='eng')
                
                # Clean up
                try:
                    os.unlink(tmp_file.name)
                except:
                    pass
                
                extracted_text = text.strip()
                logger.info(f"OCR extracted {len(extracted_text)} characters from image")
                return extracted_text
                
        except Exception as e:
            logger.error(f"Image OCR error for {image_url}: {str(e)}")
            return ""
    
    @staticmethod
    def extract_youtube_transcript(video_url: str) -> str:
        """Extract transcript from YouTube video"""
        try:
            logger.info(f"Attempting to extract YouTube transcript from: {video_url}")
            
            # Clean the URL to get the video ID
            video_id = MediaExtractor.extract_youtube_id(video_url)
            if not video_id:
                logger.error("Could not extract video ID from URL")
                return ""
            
            clean_url = f"https://www.youtube.com/watch?v={video_id}"
            logger.info(f"Using clean URL: {clean_url}")
            
            # Try YoutubeLoader first
            try:
                loader = YoutubeLoader.from_youtube_url(
                    clean_url,
                    add_video_info=True,
                    language=["en", "en-US"],
                    translation="en"
                )
                docs = loader.load()
                transcript = "\n".join([doc.page_content for doc in docs])
                
                if transcript and len(transcript.strip()) > 50:
                    logger.info(f"Successfully extracted transcript: {len(transcript)} characters")
                    return transcript.strip()
                else:
                    logger.warning("YoutubeLoader returned empty transcript")
                    
            except Exception as loader_error:
                logger.warning(f"YoutubeLoader failed: {loader_error}")
            
            # Fallback to yt-dlp for transcript (This fallback is only working for my application)
            return MediaExtractor.extract_youtube_transcript_ytdlp(clean_url)
            
        except Exception as e:
            logger.error(f"YouTube transcript error for {video_url}: {str(e)}")
            return ""
    
    @staticmethod
    def extract_youtube_id(url: str) -> str:
        """Extract YouTube video ID from various URL formats"""
        patterns = [
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]+)',
            r'(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]+)',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None
    
    @staticmethod
    def extract_youtube_transcript_ytdlp(video_url: str) -> str:
        """Extract transcript using yt-dlp"""
        try:
            logger.info(f"Attempting yt-dlp transcript extraction from: {video_url}")
            
            ydl_opts = {
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en', 'en-US'],
                'skip_download': True,
                'quiet': True,
                'no_warnings': True
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=False)
                
                # Try to get subtitles
                subtitles = info.get('subtitles', {}) or info.get('automatic_captions', {})
                
                for lang in ['en', 'en-US', 'en-GB']:
                    if lang in subtitles:
                        # Get the subtitle URL
                        subtitle_entries = subtitles[lang]
                        for entry in subtitle_entries:
                            if entry.get('ext') == 'vtt' or 'vtt' in entry.get('url', ''):
                                try:
                                    sub_response = requests.get(entry['url'], timeout=30)
                                    vtt_content = sub_response.text
                                    
                                    # Parse VTT(Video Text Track is the full form) content
                                    transcript = MediaExtractor.parse_vtt_content(vtt_content)
                                    if transcript and len(transcript) > 50:
                                        logger.info(f"Successfully extracted transcript via yt-dlp: {len(transcript)} characters")
                                        return transcript
                                        
                                except Exception as sub_error:
                                    logger.warning(f"Failed to download subtitle: {sub_error}")
                                    continue
            
            logger.warning("No suitable subtitles found")
            return ""
            
        except Exception as e:
            logger.error(f"yt-dlp transcript extraction failed: {str(e)}")
            return ""
    
    @staticmethod
    def parse_vtt_content(vtt_content: str) -> str:
        """Parse VTT subtitle content to extract text"""
        lines = vtt_content.split('\n')
        transcript_lines = []
        
        for line in lines:
            line = line.strip()
            # Skip VTT headers, timestamps, and empty lines
            if (line and 
                not line.startswith('WEBVTT') and 
                not re.match(r'^\d{2}:\d{2}:\d{2}', line) and
                not line.startswith('NOTE') and
                '-->' not in line):
                
                # Clean up HTML tags and formatting
                clean_line = re.sub(r'<[^>]+>', '', line)
                clean_line = re.sub(r'&[a-zA-Z0-9]+;', '', clean_line)
                
                if clean_line and len(clean_line) > 2:
                    transcript_lines.append(clean_line)
        
        return ' '.join(transcript_lines)
    
    @staticmethod
    def extract_video_transcript_whisper(video_url: str) -> str:
        """Extract transcript from video using Whisper (fallback)"""
        if not whisper_model:
            logger.warning("Whisper model not available")
            return ""
            
        try:
            logger.info(f"Attempting Whisper transcription for: {video_url}")
            
            # Download audio using yt-dlp
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': tempfile.mktemp(suffix='.%(ext)s'),
                'extractaudio': True,
                'audioformat': 'wav',
                'noplaylist': True,
                'quiet': True
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                audio_file = ydl.prepare_filename(info).replace('.webm', '.wav').replace('.mp4', '.wav')
            
            # Transcribe using Whisper
            result = whisper_model.transcribe(audio_file)
            transcript = result["text"]
            
            # Clean up
            try:
                if os.path.exists(audio_file):
                    os.unlink(audio_file)
            except:
                pass
            
            logger.info(f"Whisper transcribed {len(transcript)} characters")
            return transcript
            
        except Exception as e:
            logger.error(f"Whisper transcription error: {str(e)}")
            return ""

# Enhanced content extraction function
async def extract_enhanced_content(url: str, base_content: str) -> Dict[str, Any]:
    """Extract content from webpage including embedded media"""
    extracted_content = {
        "base_content": base_content,
        "pdf_content": "",
        "image_text": "",
        "video_transcripts": "",
        "media_sources": []
    }
    
    try:
        logger.info(f"Starting enhanced content extraction for: {url}")
        
        # For direct PDF URLs
        if url.lower().endswith('.pdf'):
            logger.info("Direct PDF URL detected")
            pdf_content = MediaExtractor.extract_pdf_from_url(url)
            if pdf_content:
                extracted_content["pdf_content"] = pdf_content
                extracted_content["media_sources"].append({
                    "type": "pdf",
                    "url": url,
                    "content_length": len(pdf_content)
                })
                logger.info(f"Direct PDF content extracted: {len(pdf_content)} characters")
            return extracted_content
        
        # For YouTube URLs
        if 'youtube.com' in url or 'youtu.be' in url:
            logger.info("YouTube URL detected")
            transcript = MediaExtractor.extract_youtube_transcript(url)
            if transcript:
                extracted_content["video_transcripts"] = transcript
                extracted_content["media_sources"].append({
                    "type": "video",
                    "url": url,
                    "content_length": len(transcript)
                })
                logger.info(f"YouTube transcript extracted: {len(transcript)} characters")
            return extracted_content
        
        # Get webpage HTML to find embedded media
        try:
            response = requests.get(url, timeout=30, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            html_content = response.text
            logger.info("Retrieved webpage HTML for media extraction")
        except Exception as e:
            logger.error(f"Failed to retrieve webpage HTML: {e}")
            return extracted_content
        
        # Extract PDF links
        pdf_patterns = [
            r'href=["\']([^"\']*\.pdf[^"\']*)["\']',
            r'<embed[^>]*src=["\']([^"\']*\.pdf[^"\']*)["\'][^>]*>',
            r'<object[^>]*data=["\']([^"\']*\.pdf[^"\']*)["\'][^>]*>'
        ]
        
        pdf_urls = []
        for pattern in pdf_patterns:
            matches = re.findall(pattern, html_content, re.IGNORECASE)
            pdf_urls.extend(matches)
        
        pdf_urls = list(set(pdf_urls))  # Remove duplicates
        logger.info(f"Found {len(pdf_urls)} PDF URLs")
        
        # Extract YouTube video URLs
        youtube_patterns = [
            r'<iframe[^>]*src=["\']([^"\']*youtube\.com/embed/[^"\']*)["\'][^>]*>',
            r'<iframe[^>]*src=["\']([^"\']*youtu\.be/[^"\']*)["\'][^>]*>',
            r'https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]+)',
            r'https?://youtu\.be/([a-zA-Z0-9_-]+)'
        ]
        
        video_urls = []
        for pattern in youtube_patterns:
            matches = re.findall(pattern, html_content, re.IGNORECASE)
            for match in matches:
                if isinstance(match, tuple):
                    video_id = match[0] if match[0] else match[1]
                    video_urls.append(f"https://www.youtube.com/watch?v={video_id}")
                else:
                    video_urls.append(match)
        
        video_urls = list(set(video_urls))  # Remove duplicates
        logger.info(f"Found {len(video_urls)} YouTube URLs")
        
        # Extract image URLs (focus on larger images that might contain text)
        image_patterns = [
            r'<img[^>]*src=["\']([^"\']*\.(jpg|jpeg|png|gif|bmp|webp))["\'][^>]*>',
            r'background-image:\s*url\(["\']?([^"\']*\.(jpg|jpeg|png|gif|bmp|webp))["\']?\)'
        ]
        image_urls = []
        for pattern in image_patterns:
            matches = re.findall(pattern, html_content, re.IGNORECASE)
            image_urls.extend([match[0] if isinstance(match, tuple) else match for match in matches])
        
        image_urls = list(set(image_urls))[:5]  # 5 images is the limit
        logger.info(f"Found {len(image_urls)} image URLs")
        
        # Process media in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_content = {}
            
            # Process PDFs (limit to 2 PDFs)
            for pdf_url in pdf_urls[:2]:
                absolute_url = urljoin(url, pdf_url)
                logger.info(f"Submitting PDF extraction for: {absolute_url}")
                future = executor.submit(MediaExtractor.extract_pdf_from_url, absolute_url)
                future_to_content[future] = ('pdf', absolute_url)
            
            # Process videos (limit to 2 videos)
            for video_url in video_urls[:2]:
                logger.info(f"Submitting video transcript extraction for: {video_url}")
                future = executor.submit(MediaExtractor.extract_youtube_transcript, video_url)
                future_to_content[future] = ('video', video_url)
            
            # Process images (limit to 3 images)
            for img_url in image_urls[:3]:
                absolute_url = urljoin(url, img_url)
                logger.info(f"Submitting image OCR for: {absolute_url}")
                future = executor.submit(MediaExtractor.extract_text_from_image_url, absolute_url)
                future_to_content[future] = ('image', absolute_url)
            
            # Collect results with timeout
            completed_futures = concurrent.futures.as_completed(future_to_content, timeout=120)
            for future in completed_futures:
                media_type, media_url = future_to_content[future]
                try:
                    content = future.result()
                    if content and len(content.strip()) > 30:  # Only include meaningful content
                        logger.info(f"Successfully extracted {media_type} content from {media_url}: {len(content)} chars")
                        
                        if media_type == 'pdf':
                            extracted_content["pdf_content"] += f"\n\n--- PDF Content from {media_url} ---\n{content}"
                        elif media_type == 'image':
                            extracted_content["image_text"] += f"\n\n--- Text from Image {media_url} ---\n{content}"
                        elif media_type == 'video':
                            extracted_content["video_transcripts"] += f"\n\n--- Video Transcript from {media_url} ---\n{content}"
                        
                        extracted_content["media_sources"].append({
                            "type": media_type,
                            "url": media_url,
                            "content_length": len(content)
                        })
                    else:
                        logger.info(f"Insufficient content extracted from {media_type}: {media_url}")
                        
                except concurrent.futures.TimeoutError:
                    logger.warning(f"Timeout processing {media_type} {media_url}")
                except Exception as e:
                    logger.error(f"Error processing {media_type} {media_url}: {str(e)}")
    
    except Exception as e:
        logger.error(f"Enhanced content extraction error: {str(e)}")
    
    total_extracted = len(extracted_content.get("pdf_content", "")) + len(extracted_content.get("video_transcripts", "")) + len(extracted_content.get("image_text", ""))
    logger.info(f"Enhanced content extraction completed. Total additional content: {total_extracted} characters")
    
    return extracted_content

# RAG search function using the Tavily search
async def perform_rag_search(query: str, session_id: str) -> Dict[str, Any]:
    """Perform RAG search using Tavily and return results with sources"""
    
    if not tavily_tool:
        return {"context": "", "sources": [], "query": query}
    
    # Check cache first
    cache_key = hashlib.md5(f"{session_id}:{query}".encode()).hexdigest()
    if cache_key in tavily_cache:
        return tavily_cache[cache_key]
    
    try:
        # Perform Tavily search
        search_results = tavily_tool.run(query)
        
        # Process results
        sources = []
        combined_context = ""
        
        if isinstance(search_results, list):
            for result in search_results[:5]:  # Limit to top 5 results
                if isinstance(result, dict):
                    url = result.get('url', '')
                    title = result.get('title', '')
                    content = result.get('content', '')
                    
                    if url and content:
                        sources.append({
                            "url": url,
                            "title": title,
                            "content": content[:500] + "..." if len(content) > 500 else content
                        })
                        combined_context += f"\n\nSource: {title} ({url})\n{content}\n"
        
        rag_result = {
            "context": combined_context,
            "sources": sources,
            "query": query
        }
        
        # Cache the result
        tavily_cache[cache_key] = rag_result
        
        return rag_result
    
    except Exception as e:
        logger.error(f"RAG search error: {str(e)}")
        return {"context": "", "sources": [], "query": query}

#Used to get the length of the instructions for the prompt to be fed to the llm
def get_summary_prompt(length: str, content: str, title: str = None) -> str:
    """Generate appropriate prompt based on summary length preference with enhanced formatting for chatbot context"""
    
    length_instructions = {
        "short": """Provide a concise 2-3 sentence summary highlighting only the main points. Format as:
        • Main point 1
        • Main point 2
        • Key conclusion""",
        "medium": """Provide a comprehensive summary covering the key points and important details. Format as:
        
        **Main Topic:** Brief description
        
        **Key Points:**
        • Point 1 with brief explanation
        • Point 2 with brief explanation
        • Point 3 with brief explanation
        
        **Conclusion:** Final takeaway or outcome""",
        "long": """Provide a detailed summary with comprehensive coverage. Format as:
        
        **Overview:** Brief introduction to the topic
        
        **Main Arguments/Points:**
        • Key point 1: Detailed explanation
        • Key point 2: Detailed explanation
        • Key point 3: Detailed explanation
        
        **Supporting Evidence:**
        • Important data or facts
        • Statistics or examples mentioned
        
        **Key Takeaways:**
        • Actionable insight 1
        • Actionable insight 2
        
        **Conclusion:** Final summary and implications"""
    }
    
    return f"""Please summarize the following content. {length_instructions[length]}

Title: {title or "Content"}

Content:
{content[:8000]}  # Limit content to prevent token overflow

Important formatting guidelines:
- Use bullet points (•) for lists
- Use **bold** for section headers
- Keep each bullet point concise but informative
- Focus on the most important information
- Make it scannable and easy to read
- Do not include any introductory phrases like "Here's a summary" or "This content discusses"
- Start directly with the formatted content"""
    
def get_followup_questions_prompt(content: str, conversation_history: List[Dict], last_answer: str) -> str:
    """Generate prompt for suggesting follow-up questions"""
    
    # Get last few exchanges for context
    recent_history = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
    history_text = "\n".join([f"Q: {msg['content']}" if msg['role'] == 'user' else f"A: {msg['content']}" for msg in recent_history])
    
    return f"""Based on the content and our conversation, suggest 3-5 relevant follow-up questions that the user might want to ask.

Content Summary (for context):
{content[:2000]}

Recent Conversation:
{history_text}

Last Answer Given:
{last_answer[:1000]}

Generate 3-5 concise, specific questions that:
1. Dive deeper into topics mentioned in the content
2. Ask for clarification or examples
3. Explore implications or applications
4. Request comparisons or analysis
5. Are directly answerable from the content

Format as a simple list with no numbering or bullets:
Question 1 here
Question 2 here
Question 3 here
Question 4 here
Question 5 here

Keep each question under 12 words and make them conversational."""

# Enhanced AI response generation with RAG
async def generate_ai_response_with_rag(messages: List[Dict[str, str]], original_content: str, session_id: str) -> Dict[str, Any]:
    """Generate AI response with RAG integration"""
    
    # Get the user's latest question
    user_question = messages[-1]["content"] if messages and messages[-1]["role"] == "user" else ""
    
    # Perform RAG search if the question seems to require external information
    rag_needed = any(keyword in user_question.lower() for keyword in [
        "latest", "recent", "current", "today", "news", "compare", "versus", "vs", 
        "what about", "how does", "similar", "different", "other", "also", "additionally"
    ])
    
    rag_result = None
    if rag_needed and tavily_tool:
        rag_result = await perform_rag_search(user_question, session_id)
    
    # Create enhanced system prompt
    system_content = f"""You are an AI assistant helping users understand content through interactive Q&A.

CONTENT TO ANALYZE:
{original_content[:6000]}"""
    
    if rag_result and rag_result["context"]:
        system_content += f"""

ADDITIONAL RELEVANT INFORMATION FROM EXTERNAL SOURCES:
{rag_result["context"][:3000]}

When using external information, mention that you're drawing from additional sources."""
    
    system_content += """

Instructions:
- Answer questions based on the provided content and any additional sources
- Be conversational but informative
- Use bullet points and formatting when helpful
- If asked about something not in the content, politely say so
- Keep responses focused and relevant
- Use examples from the content when possible
- Be concise but thorough
- If external sources are used, acknowledge them appropriately"""

    # Prepare messages for the model
    model_messages = [{"role": "system", "content": system_content}]
    
    # Add conversation history
    for msg in messages:
        model_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })
    
    try:
        # Use LangChain to generate response
        response = gemini_model.invoke(model_messages)
        
        return {
            "response": response.content.strip(),
            "sources": rag_result["sources"] if rag_result else [],
            "rag_used": bool(rag_result and rag_result["context"])
        }
    
    except Exception as e:
        logger.error(f"AI response generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI response error: {str(e)}")

async def generate_ai_response(messages: List[Dict[str, str]], original_content: str) -> str:
    """Generate AI response with full conversation context (legacy function)"""
    
    # Create system message with original content
    system_prompt = f"""You are an AI assistant helping users understand content through interactive Q&A. 

CONTENT TO ANALYZE:
{original_content[:6000]}

Instructions:
- Answer questions based ONLY on the provided content
- Be conversational but informative
- Use bullet points and formatting when helpful
- If asked about something not in the content, politely say so
- Keep responses focused and relevant
- Use examples from the content when possible
- Be concise but thorough

Previous conversation context is provided in the messages below."""

    # Prepare messages for the model
    model_messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history
    for msg in messages:
        model_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })
    
    try:
        # Use LangChain to generate response
        response = gemini_model.invoke(model_messages)
        return response.content.strip()
    
    except Exception as e:
        logger.error(f"AI response generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI response error: {str(e)}")

async def generate_followup_questions(content: str, conversation_history: List[Dict], last_answer: str) -> List[str]:
    """Generate suggested follow-up questions"""
    
    prompt = get_followup_questions_prompt(content, conversation_history, last_answer)
    
    try:
        response = gemini_model.invoke([{"role": "user", "content": prompt}])
        
        # Parse questions from response
        questions_text = response.content.strip()
        questions = [q.strip() for q in questions_text.split('\n') if q.strip()]
        
        # Clean and validate questions
        valid_questions = []
        for q in questions[:5]:  # Max 5 questions
            if q and len(q) > 10 and '?' not in q:
                q = q + '?'
            if q and len(q) <= 100:  # Reasonable length
                valid_questions.append(q)
        
        return valid_questions[:4]  # Return max 4 questions
    
    except Exception as e:
        logger.error(f"Follow-up questions generation error: {str(e)}")
        # Return default questions if generation fails
        return [
            "Can you explain this in more detail?",
            "What are the key implications?",
            "Are there any examples mentioned?",
            "How does this relate to current trends?"
        ]

# This is used to check whether our gemini model is working or not by visiting the localhost url
@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "AI Web Summarizer Chatbot API with RAG is running",
        "version": "3.0.0",
        "features": [
            "Interactive Q&A",
            "Conversation context",
            "Follow-up suggestions",
            "Session management",
            "RAG with Tavily search" if tavily_tool else "RAG disabled (no API key)",
            "PDF extraction",
            "Image OCR",
            "Video transcription" if whisper_model else "Video transcription limited"
        ],
        "gemini_available": True,
        "tavily_available": bool(tavily_tool),
        "whisper_available": bool(whisper_model),
        "active_sessions": session_manager.get_session_count()
    }

# Enhanced summarize endpoint with media extraction
@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_content(request: SummarizeRequest, background_tasks: BackgroundTasks):
    """Enhanced summarize endpoint with media extraction and RAG"""
    
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    
    logger.info(f"Summarization request for URL: {request.url}")
    logger.info(f"Base content length: {len(request.content)} characters")
    
    try:
        # Extract enhanced content including media
        enhanced_content_dict = {}
        if request.url:
            enhanced_content_dict = await extract_enhanced_content(request.url, request.content)
        
        # Combine all content
        full_content = request.content
        additional_content_parts = []
        
        if enhanced_content_dict.get("pdf_content"):
            pdf_content = enhanced_content_dict["pdf_content"].strip()
            if pdf_content:
                full_content += "\n\n=== EXTRACTED PDF CONTENT ===\n" + pdf_content
                additional_content_parts.append(f"PDF content ({len(pdf_content)} chars)")
        
        if enhanced_content_dict.get("image_text"):
            image_text = enhanced_content_dict["image_text"].strip()
            if image_text:
                full_content += "\n\n=== EXTRACTED IMAGE TEXT ===\n" + image_text
                additional_content_parts.append(f"Image text ({len(image_text)} chars)")
        
        if enhanced_content_dict.get("video_transcripts"):
            video_text = enhanced_content_dict["video_transcripts"].strip()
            if video_text:
                full_content += "\n\n=== VIDEO TRANSCRIPTS ===\n" + video_text
                additional_content_parts.append(f"Video transcripts ({len(video_text)} chars)")
        
        logger.info(f"Total content after enhancement: {len(full_content)} characters")
        if additional_content_parts:
            logger.info(f"Additional content extracted: {', '.join(additional_content_parts)}")
        
        # Check if we have enough content
        if len(full_content.strip()) < 50:
            logger.warning(f"Content too short after enhancement: {len(full_content)} characters")
            raise HTTPException(status_code=400, detail="Content too short to summarize effectively. Try a different page or check if the content loaded properly.")
        
        # Generate summary using enhanced content
        prompt = get_summary_prompt(request.summary_length, full_content, request.title)
        response = gemini_model.invoke([{"role": "user", "content": prompt}])
        summary = response.content.strip()
        
        # Create new chat session with enhanced content
        session_id = session_manager.create_session(
            original_content=full_content,  # Store enhanced content
            title=request.title or "Untitled Page",
            url=request.url
        )
        
        # Store media sources in session
        if enhanced_content_dict.get("media_sources"):
            session_manager.add_media_sources(session_id, enhanced_content_dict["media_sources"])
        
        # Add initial summary to conversation
        session_manager.add_message(session_id, "assistant", summary)
        
        # Generate initial follow-up questions
        followup_questions = await generate_followup_questions(
            full_content, [], summary
        )
        
        word_count = len(summary.split())
        
        logger.info(f"Summarization completed successfully. Session: {session_id}")
        
        return SummarizeResponse(
            summary=summary,
            word_count=word_count,
            provider_used="gemini",
            success=True,
            session_id=session_id,
            followup_questions=followup_questions,
            media_sources=[MediaSource(**source) for source in enhanced_content_dict.get("media_sources", [])]
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Summarization error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during summarization")

# Enhanced chat endpoint with RAG
@app.post("/chat", response_model=ChatResponse)
async def chat_with_content(request: ChatRequest):
    """Handle follow-up questions with RAG integration"""
    
    # Validate session
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    try:
        # Add user message to conversation
        session_manager.add_message(request.session_id, "user", request.message)
        
        # Get conversation history
        conversation_history = session_manager.get_conversation(request.session_id)
        
        # Generate AI response with RAG
        ai_response_data = await generate_ai_response_with_rag(
            conversation_history, 
            session["original_content"],
            request.session_id
        )
        
        ai_response = ai_response_data["response"]
        sources = ai_response_data.get("sources", [])
        
        # Add AI response to conversation
        session_manager.add_message(request.session_id, "assistant", ai_response)
        
        # Generate new follow-up questions
        followup_questions = await generate_followup_questions(
            session["original_content"],
            conversation_history,
            ai_response
        )
        
        return ChatResponse(
            response=ai_response,
            followup_questions=followup_questions,
            session_id=request.session_id,
            success=True,
            sources=[Source(**source) for source in sources]
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during chat")

@app.get("/session/{session_id}", response_model=SessionInfo)
async def get_session_info(session_id: str):
    """Get session information and conversation history"""
    
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    conversation = session_manager.get_conversation(session_id)
    
    return SessionInfo(
        session_id=session_id,
        title=session["title"],
        url=session["url"],
        created_at=session["created_at"].isoformat(),
        conversation_history=conversation,
        message_count=len(conversation)
    )

@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Delete a chat session"""
    
    success = session_manager.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Clean up Tavily cache for this session
    keys_to_remove = [key for key in tavily_cache.keys() if session_id in key]
    for key in keys_to_remove:
        del tavily_cache[key]
    
    return {"message": "Session deleted successfully"}

@app.get("/extract-pdf")
def extract_pdf(url: str = Query(...)):
    try:
        response = requests.get(url)
        response.raise_for_status()
        pdf_bytes = io.BytesIO(response.content)
        reader = PdfReader(pdf_bytes)

        text = ""
        for page in reader.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"

        if not text.strip():
            return "No text found in PDF. It may be scanned or image-based."

        return text.strip()

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Background task to clean up old sessions
@app.on_event("startup")
async def startup_event():
    """Clean up old sessions on startup"""
    session_manager.cleanup_expired_sessions()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)