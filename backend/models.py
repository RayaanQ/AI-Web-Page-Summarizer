# NEW: Added source attribution models
from pydantic import BaseModel
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime

# NEW: Source model for RAG attribution
class Source(BaseModel):
    url: str
    title: str
    content: str

# NEW: Media source model
class MediaSource(BaseModel):
    type: Literal["pdf", "image", "video"]
    url: str
    content_length: int

# Request Models
class SummarizeRequest(BaseModel):
    content: str
    url: Optional[str] = None
    title: Optional[str] = None
    summary_length: Literal["short", "medium", "long"] = "medium"

class ChatRequest(BaseModel):
    session_id: str
    message: str

# Response Models
class SummarizeResponse(BaseModel):
    summary: str
    word_count: int
    provider_used: str
    success: bool
    session_id: str
    followup_questions: List[str]
    media_sources: List[MediaSource] = []  # NEW: Media sources extracted

class ChatResponse(BaseModel):
    response: str
    followup_questions: List[str]
    session_id: str
    success: bool
    sources: List[Source] = []  # NEW: RAG sources
    
class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    timestamp: str

class SessionInfo(BaseModel):
    session_id: str
    title: str
    url: Optional[str]
    created_at: str
    conversation_history: List[ConversationMessage]
    message_count: int