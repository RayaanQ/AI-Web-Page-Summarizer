import uuid
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import threading

class SessionManager:
    """Manages chat sessions and conversation history in memory with media source support"""
    
    def __init__(self, session_timeout_hours: int = 24):
        self.sessions: Dict[str, Dict] = {}
        self.session_timeout = timedelta(hours=session_timeout_hours)
        self.lock = threading.Lock()
    
    def create_session(self, original_content: str, title: str, url: Optional[str] = None) -> str:
        """Create a new chat session"""
        
        session_id = str(uuid.uuid4())
        
        with self.lock:
            self.sessions[session_id] = {
                "id": session_id,
                "original_content": original_content,
                "title": title,
                "url": url,
                "created_at": datetime.now(),
                "last_activity": datetime.now(),
                "conversation": [],
                "media_sources": []  # NEW: Store media sources for the session
            }
        
        return session_id
    
    def get_session(self, session_id: str) -> Optional[Dict]:
        """Get session by ID"""
        
        with self.lock:
            session = self.sessions.get(session_id)
            if session:
                # Update last activity
                session["last_activity"] = datetime.now()
                return session.copy()
            return None
    
    def add_message(self, session_id: str, role: str, content: str) -> bool:
        """Add a message to the conversation history"""
        
        with self.lock:
            if session_id in self.sessions:
                message = {
                    "role": role,
                    "content": content,
                    "timestamp": datetime.now().isoformat()
                }
                self.sessions[session_id]["conversation"].append(message)
                self.sessions[session_id]["last_activity"] = datetime.now()
                return True
            return False
    
    # NEW: Add media sources to a session
    def add_media_sources(self, session_id: str, media_sources: List[Dict]) -> bool:
        """Add media sources to a session"""
        
        with self.lock:
            if session_id in self.sessions:
                self.sessions[session_id]["media_sources"].extend(media_sources)
                return True
            return False
    
    # NEW: Get media sources for a session
    def get_media_sources(self, session_id: str) -> List[Dict]:
        """Get media sources for a session"""
        
        with self.lock:
            if session_id in self.sessions:
                return self.sessions[session_id]["media_sources"].copy()
            return []
    
    def get_conversation(self, session_id: str) -> List[Dict]:
        """Get conversation history for a session"""
        
        with self.lock:
            if session_id in self.sessions:
                return self.sessions[session_id]["conversation"].copy()
            return []
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a session"""
        
        with self.lock:
            if session_id in self.sessions:
                del self.sessions[session_id]
                return True
            return False
    
    def cleanup_expired_sessions(self) -> int:
        """Remove expired sessions and return count of removed sessions"""
        
        now = datetime.now()
        expired_sessions = []
        
        with self.lock:
            for session_id, session in self.sessions.items():
                if now - session["last_activity"] > self.session_timeout:
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                del self.sessions[session_id]
        
        return len(expired_sessions)
    
    def get_session_count(self) -> int:
        """Get total number of active sessions"""
        with self.lock:
            return len(self.sessions)