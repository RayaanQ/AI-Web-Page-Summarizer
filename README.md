# AI Web Page Summarizer with RAG

An intelligent Chrome extension that summarizes web pages and enables interactive Q&A using AI, enhanced with Retrieval-Augmented Generation (RAG), automatic media extraction, and multi-source content analysis.

## 🚀 Features

### Core Functionality
- **Smart Web Page Summarization**: Extract and summarize content from any webpage
- **Interactive Q&A**: Chat with the content using natural language
- **Session Management**: Maintain conversation context throughout your browsing session

### Advanced AI Capabilities
- **RAG Integration**: Combines webpage content with external search results using Tavily
- **Multi-Modal Content Extraction**:
  - 📄 **PDF Documents**: Automatic extraction from embedded PDFs using PyPDFLoader
  - 🖼️ **Image OCR**: Extract text from images using Tesseract OCR
  - 🎥 **Video Transcripts**: YouTube video transcript extraction using yt-dlp
- **Source Attribution**: Clickable source links with hide/unhide functionality

### Technical Features
- **Parallel Processing**: Simultaneous extraction from multiple media sources
- **Smart Caching**: Session-based caching for improved response times  
- **Content Enhancement**: Combines webpage text with extracted media content
- **Follow-up Suggestions**: AI-generated relevant questions for deeper exploration

## ⚙️ Backend Setup

### Create a virtual environment for the packages to be stored in the virtual environment
```bash
Python -m venv <environment name>
\<environment name>\Scripts\activate
```

### 📁 1. Navigate to the Backend Directory
```bash
cd backend
```

### 📦 2. Install Python Dependencies
Make sure you have Python 3.9+ and pip installed:
```bash
pip install -r requirements.txt
```

### 🔐 3. Configure Environment Variables
Create a `.env` file in the backend directory and add your API keys:

**Required:**
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

**Optional (for enhanced features):**
```env
TAVILY_API_KEY=your_tavily_api_key_here     # For RAG search functionality
OPENAI_API_KEY=your_openai_api_key_here     # For better embeddings (fallback available)
```

#### 🔑 Getting API Keys:
- **Gemini API**: Get from [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Tavily API**: Sign up at [Tavily.com](https://tavily.com) for RAG search
- **OpenAI API**: Get from [OpenAI Platform](https://platform.openai.com/api-keys) (optional)

### 🚀 4. Run the Development Server
Start the backend server:
```bash
uvicorn main:app --reload --port 8000
```

The server will start at: **http://localhost:8000**

#### ✅ Verify Installation:
Visit `http://localhost:8000` to see the API status and available features.

### 📋 System Requirements
The application requires these external tools for media processing:

**Required:**
- **FFmpeg**: Required for video processing with yt-dlp
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: Download from [FFmpeg.org](https://ffmpeg.org/download.html)
  
- **Tesseract OCR**: Required for image text extraction
  - Ubuntu/Debian: `sudo apt-get install tesseract-ocr`
  - macOS: `brew install tesseract`
  - Windows: Download from [GitHub releases](https://github.com/UB-Mannheim/tesseract/wiki)

**Notes:**
- PDF extraction uses PyPDFLoader (no external dependencies needed)
- Video transcripts extracted using yt-dlp (requires FFmpeg)
- Image text extraction uses pytesseract (requires Tesseract OCR)

## 🌐 Chrome Extension Setup

### 📁 1. Load the Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension` folder from this project

### ⚙️ 2. Configure Backend URL
The extension is pre-configured to connect to `http://localhost:8000`. If your backend runs on a different port, update the API URL in `popup.js`.

### 🎯 3. Start Using
1. Navigate to any webpage
2. Click the extension icon in your toolbar
3. Choose summary length and click "Summarize"
4. Interact with the content through the chat interface

## 🔧 API Endpoints

### Core Endpoints
- `GET /` - Health check and feature status
- `POST /summarize` - Summarize webpage with media extraction
- `POST /chat` - Interactive Q&A with RAG integration
- `GET /session/{session_id}` - Retrieve session info and history
- `DELETE /session/{session_id}` - Delete session and cleanup

### Media Extraction Features
- **PDF Extraction**: Uses PyPDFLoader for direct text extraction from PDF documents
- **Image OCR**: Text extraction from images using Tesseract OCR via pytesseract
- **Video Transcripts**: YouTube transcript extraction using yt-dlp (with FFmpeg)
- **Parallel Processing**: All media sources processed simultaneously

### RAG Integration
- **Tavily Search**: External search results integrated with webpage content
- **Source Attribution**: All external sources tracked and displayed
- **Context Merging**: Intelligent combination of page content and search results
- **Session Caching**: Search results cached for improved performance

## 🎨 User Interface Features

### Summary Display
- **Multiple Length Options**: Short, medium, or detailed summaries
- **Formatted Output**: Bullet points and structured content
- **Word Count**: Summary statistics
- **Media Sources**: List of extracted content sources

### Interactive Chat
- **Context-Aware**: Maintains conversation history
- **Follow-up Suggestions**: AI-generated relevant questions
- **Source Integration**: External search results when needed
- **Real-time Responses**: Fast API response times

### Source Management
- **Collapsible Sources**: Hide/show external source links
- **Clickable URLs**: Direct access to referenced content
- **Source Types**: PDF, Image, Video, and Search result indicators

## 🛠️ Development

### Backend Development
- **FastAPI**: Modern Python web framework
- **LangChain**: LLM orchestration and document processing
- **Gemini**: Primary language model
- **Tavily**: External search integration
- **Media Processing**: PyPDFLoader, yt-dlp, pytesseract
- **Parallel Processing**: Concurrent media extraction

### Frontend Development
- **Vanilla JavaScript**: No framework dependencies
- **Chrome Extension APIs**: Native browser integration
- **Responsive Design**: Clean, minimal interface
- **Session Persistence**: Maintains state across interactions

## 🔍 Troubleshooting

### Common Issues
1. **API Key Errors**: Verify all required keys are set in `.env`
2. **CORS Issues**: Ensure backend is running on port 8000
3. **FFmpeg Missing**: Install FFmpeg for video processing to work
4. **Tesseract Missing**: Install Tesseract OCR for image text extraction
5. **Slow Performance**: RAG search and media extraction may take 10-30 seconds

### Debug Information
- Check browser console for extension errors
- Monitor backend logs for processing details
- Visit `/` endpoint to verify service status
- Test individual features using API documentation

**🚀 Ready to enhance your web browsing experience with AI-powered content analysis!**
