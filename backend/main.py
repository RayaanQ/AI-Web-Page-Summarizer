from fastapi import FastAPI, HTTPException, BackgroundTasks
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
from models import *


load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI WebPage Chatbot API",
    description="API for interactive Q&A with webpage content using AI",
    version="2.0.0"
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


# Using Gemini LLM here for our responses through the langchain setup cause google.generativeai technique was not working
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set")

os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY
gemini_model = init_chat_model("gemini-2.5-flash", model_provider="google_genai")


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
    
    return f"""Please summarize the following webpage content. {length_instructions[length]}

Title: {title or "Not provided"}

Content:
{content[:8000]}  # Limit content to prevent token overflow

Important formatting guidelines:
- Use bullet points (•) for lists
- Use **bold** for section headers
- Keep each bullet point concise but informative
- Focus on the most important information
- Make it scannable and easy to read
- Do not include any introductory phrases like "Here's a summary" or "This article discusses"
- Start directly with the formatted content"""
    
def get_followup_questions_prompt(content: str, conversation_history: List[Dict], last_answer: str) -> str:
    """Generate prompt for suggesting follow-up questions"""
    
    # Get last few exchanges for context
    recent_history = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
    history_text = "\n".join([f"Q: {msg['content']}" if msg['role'] == 'user' else f"A: {msg['content']}" for msg in recent_history])
    
    return f"""Based on the webpage content and our conversation, suggest 3-5 relevant follow-up questions that the user might want to ask.

Original Content Summary (for context):
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
5. Are directly answerable from the webpage content

Format as a simple list with no numbering or bullets:
Question 1 here
Question 2 here
Question 3 here
Question 4 here
Question 5 here

Keep each question under 12 words and make them conversational."""

async def generate_ai_response(messages: List[Dict[str, str]], original_content: str) -> str:
    """Generate AI response with full conversation context"""
    
    # Create system message with original content
    system_prompt = f"""You are an AI assistant helping users understand webpage content through interactive Q&A. 

ORIGINAL WEBPAGE CONTENT:
{original_content[:6000]}

Instructions:
- Answer questions based ONLY on the provided webpage content
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


#This function will feed the prompt above to the gemini model
# async def summarize_with_gemini(content: str, title: str = None, length: str = "medium") -> str:
#     prompt = get_summary_prompt(length, content, title)
    
#     try:
#         # Langchain Gemini is called here
#         response = gemini_model.invoke([{"role": "user", "content": prompt}])
#         summary_text = response.text()
#         return summary_text.strip()
    
#     except Exception as e:
#         logger.error(f"LangChain Gemini error: {str(e)}")
#         raise HTTPException(status_code=500, detail=f"Gemini model error: {str(e)}")


# This is used to check whether our gemini model is working or not by visiting the localhost url
@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "AI Web Summarizer Chatbot API is running",
        "version": "2.0.0",
        "features": [
            "Interactive Q&A",
            "Conversation context",
            "Follow-up suggestions",
            "Session management"
        ],
        "gemini_available": True,
        "active_sessions": session_manager.get_session_count()
    }

#This will commit the summarization part to the model to produce an output
@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_content(request: SummarizeRequest, background_tasks: BackgroundTasks):
    """Enhanced summarize endpoint that creates a new chat session"""
    
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    
    if len(request.content) < 50:
        raise HTTPException(status_code=400, detail="Content too short to summarize")
    
    try:
        # Generate summary using existing logic
        prompt = get_summary_prompt(request.summary_length, request.content, request.title)
        response = gemini_model.invoke([{"role": "user", "content": prompt}])
        summary = response.content.strip()
        
        # Create new chat session
        session_id = session_manager.create_session(
            original_content=request.content,
            title=request.title or "Untitled Page",
            url=request.url
        )
        
        # Add initial summary to conversation
        session_manager.add_message(session_id, "assistant", summary)
        
        # Generate initial follow-up questions
        followup_questions = await generate_followup_questions(
            request.content, [], summary
        )
        
        word_count = len(summary.split())
        
        return SummarizeResponse(
            summary=summary,
            word_count=word_count,
            provider_used="gemini",
            success=True,
            session_id=session_id,
            followup_questions=followup_questions
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Summarization error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/chat", response_model=ChatResponse)
async def chat_with_content(request: ChatRequest):
    """Handle follow-up questions and maintain conversation context"""
    
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
        
        # Generate AI response with full context
        ai_response = await generate_ai_response(
            conversation_history, 
            session["original_content"]
        )
        
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
            success=True
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

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
    
    return {"message": "Session deleted successfully"}

# Background task to clean up old sessions
@app.on_event("startup")
async def startup_event():
    """Clean up old sessions on startup"""
    session_manager.cleanup_expired_sessions()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)