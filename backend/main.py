from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
import os
from dotenv import load_dotenv
import google.generativeai as genai
import logging
from langchain.chat_models import init_chat_model


load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI WebPage Summarizer API",
    description="API for summarizing webpage content using AI",
    version="1.0.0"
)

# Configured this to not get CORS error
app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Model is used here for validating, streaming and for request and response tasks
class SummarizeRequest(BaseModel):
    content: str
    url: Optional[str] = None
    title: Optional[str] = None
    summary_length: Literal["short", "medium", "long"] = "medium"

class SummarizeResponse(BaseModel):
    summary: str
    word_count: int
    provider_used: str
    success: bool

# Using Gemini LLM here for our responses through the langchain setup cause google.generativeai technique was not working
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set")

os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY
gemini_model = init_chat_model("gemini-2.5-flash", model_provider="google_genai")


#Used to get the length of the instructions for the prompt to be fed to the llm
def get_summary_prompt(length: str, content: str, title: str = None) -> str:
    """Generate appropriate prompt based on summary length preference"""
    
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
    
    base_prompt = f"""Please summarize the following webpage content. {length_instructions[length]}

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
    
    return base_prompt


#This function will feed the prompt above to the gemini model
async def summarize_with_gemini(content: str, title: str = None, length: str = "medium") -> str:
    prompt = get_summary_prompt(length, content, title)
    
    try:
        # Langchain Gemini is called here
        response = gemini_model.invoke([{"role": "user", "content": prompt}])
        summary_text = response.text()
        return summary_text.strip()
    
    except Exception as e:
        logger.error(f"LangChain Gemini error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Gemini model error: {str(e)}")


# This is used to check whether our gemini model is working or not by visiting the localhost url
@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "AI Web Summarizer API is running, Good job mate",
        "gemini_available": True
    }

#This will commit the summarization part to the model to produce an output
@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_content(request: SummarizeRequest):
    """Main endpoint to summarize webpage content"""
    
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    
    if len(request.content) < 50:
        raise HTTPException(status_code=400, detail="Content too short to summarize")
    
    try:
        
        if gemini_model:
            summary = await summarize_with_gemini(request.content, request.title, request.summary_length)
            provider_used = "gemini"
       
        else:
            raise HTTPException(status_code=500, detail="Gemini not available")
        
        word_count = len(summary.split())
        
        return SummarizeResponse(
            summary=summary,
            word_count=word_count,
            provider_used=provider_used,
            success=True
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)