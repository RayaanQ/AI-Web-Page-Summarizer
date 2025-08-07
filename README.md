# AI-Web-Page-Summarizer

⚙️ Backend Setup
📁 1. Navigate to the Backend Directory
cd backend

📦 2. Install Python Dependencies
Make sure you have Python 3.9+ and pip installed.
pip install -r requirements.txt

🔐 3. Configure Environment Variables
Create a .env file in the backend directory and add your API key(s):
# .env
GEMINI_API_KEY=your_gemini_api_key
Replace your_gemini_api_key with your actual API key from Google Gemini or your LLM provider.

🚀 4. Run the Development Server
Start the backend server using uvicorn:
uvicorn main:app --reload --port 8000

The server will start at:
http://localhost:8000
