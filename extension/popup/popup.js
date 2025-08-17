// Content extraction function (injected into page)
function extractContentFromPage() {
    function cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim();
    }

    function getMainContent() {
        const elementsToRemove = [
            'script', 'style', 'nav', 'header', 'footer', 
            'aside', 'form', '.advertisement', '.ads',
            '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
        ];
        const contentSelectors = [
            'article', 'main', '[role="main"]', '.content',
            '.post-content', '.entry-content', '.article-content'
        ];
        
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const clone = element.cloneNode(true);
                elementsToRemove.forEach(sel => {
                    clone.querySelectorAll(sel).forEach(el => el.remove());
                });
                const text = clone.innerText || clone.textContent || '';
                if (text.length > 200) {
                    return cleanText(text);
                }
            }
        }
        
        const bodyClone = document.body.cloneNode(true);
        elementsToRemove.forEach(sel => {
            bodyClone.querySelectorAll(sel).forEach(el => el.remove());
        });
        return cleanText(bodyClone.innerText || bodyClone.textContent || '');
    }

    const title = document.title || 'Untitled Page';
    const url = window.location.href;
    const content = getMainContent();
    const metaDescription = document.querySelector('meta[name="description"]');
    const description = metaDescription ? metaDescription.getAttribute('content') : '';

    return {
        title,
        url,
        content,
        description,
        wordCount: content.split(/\s+/).length,
        timestamp: new Date().toISOString()
    };
}

class WebSummarizerChatbot {
    constructor() {
        this.apiUrl = 'http://localhost:8000';
        this.elements = {};
        this.currentPageData = null;
        this.currentSession = null;
        this.isLoading = false;
        this.currentSources = [];
        this.sourcesVisible = false;
        
        this.init();
    }
    
    init() {
        this.bindElements();
        this.attachEventListeners();
        this.loadSettings();
        this.extractPageContent();
    }
    
    bindElements() {
        this.elements = {
            initialControls: document.getElementById('initial-controls'),
            length: document.getElementById('length'),
            summarizeBtn: document.getElementById('summarize-btn'),
            chatInterface: document.getElementById('chat-interface'),
            chatMessages: document.getElementById('chat-messages'),
            messageInput: document.getElementById('message-input'),
            sendBtn: document.getElementById('send-btn'),
            charCount: document.getElementById('char-count'),
            pageTitle: document.getElementById('page-title'),
            newChatBtn: document.getElementById('new-chat-btn'),
            suggestedQuestions: document.getElementById('suggested-questions'),
            suggestionsList: document.getElementById('suggestions-list'),
            sourcesSection: document.getElementById('sources-section'),
            sourcesToggle: document.getElementById('sources-toggle'),
            sourcesToggleText: document.getElementById('sources-toggle-text'),
            sourcesCount: document.getElementById('sources-count'),
            sourcesList: document.getElementById('sources-list'),
            loading: document.getElementById('loading'),
            loadingText: document.getElementById('loading-text'),
            error: document.getElementById('error'),
            errorMessage: document.getElementById('error-message'),
            retryBtn: document.getElementById('retry-btn'),
            welcome: document.getElementById('welcome'),
            sessionInfo: document.getElementById('session-info')
        };
    }
    
    attachEventListeners() {
        this.elements.summarizeBtn.addEventListener('click', () => this.handleInitialSummarize());
        this.elements.messageInput.addEventListener('input', (e) => this.handleInputChange(e));
        this.elements.messageInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
        this.elements.sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.elements.newChatBtn.addEventListener('click', () => this.handleNewChat());
        this.elements.retryBtn.addEventListener('click', () => this.handleRetry());
        this.elements.length.addEventListener('change', () => this.saveSettings());
        
        // Sources toggle event listener
        this.elements.sourcesToggle.addEventListener('click', () => this.toggleSources());

        // Enable/disable send button on input
        this.elements.messageInput.addEventListener('input', () => {
            this.elements.sendBtn.disabled = this.elements.messageInput.value.trim().length === 0 || this.isLoading;
        });
    }
    
    handleInputChange(e) {
        const text = e.target.value;
        this.elements.charCount.textContent = text.length;
        this.elements.sendBtn.disabled = text.trim().length === 0 || this.isLoading;

        if (text.length > 450) {
            this.elements.charCount.style.color = '#dc3545';
        } else if (text.length > 400) {
            this.elements.charCount.style.color = '#ffc107';
        } else {
            this.elements.charCount.style.color = '#999';
        }
    }
    
    handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendMessage();
        }
    }
    
    async loadSettings() {
        try {
            const settings = await chrome.storage.sync.get(['length']);
            if (settings.length) {
                this.elements.length.value = settings.length;
            }
        } catch (error) {
            console.log('Could not load settings:', error);
        }
    }
    
    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                length: this.elements.length.value
            });
        } catch (error) {
            console.log('Could not save settings:', error);
        }
    }
    
    async extractPageContent() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('No active tab found');
            if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
                this.showError('Cannot analyze browser internal pages');
                return;
            }
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractContentFromPage
            });
            
            if (results && results[0] && results[0].result) {
                this.currentPageData = results[0].result;
                this.elements.summarizeBtn.disabled = false;
                this.elements.pageTitle.textContent = this.currentPageData.title;
                
                // Show different messages based on content type
                if (this.currentPageData.url.toLowerCase().includes('.pdf')) {
                    this.updateWelcomeForContentType('PDF Document');
                } else if (this.currentPageData.url.includes('youtube.com') || this.currentPageData.url.includes('youtu.be')) {
                    this.updateWelcomeForContentType('YouTube Video');
                } else {
                    this.updateWelcomeForContentType('Web Page');
                }
            } else {
                throw new Error('Could not extract page content');
            }
        } catch (error) {
            console.error('Error extracting content:', error);
            this.showError('Could not extract page content. Please refresh the page and try again.');
            this.elements.summarizeBtn.disabled = true;
        }
    }
    
    updateWelcomeForContentType(contentType) {
        const welcomeElement = this.elements.welcome.querySelector('p');
        if (welcomeElement) {
            welcomeElement.textContent = `This extension creates an interactive AI chatbot for any ${contentType.toLowerCase()} with enhanced features.`;
        }
    }
    
    async handleInitialSummarize() {
        if (!this.currentPageData) {
            this.showError('No page content available. Please refresh and try again.');
            return;
        }
        
        // Enhanced content validation
        const minContentLength = this.currentPageData.url.toLowerCase().includes('.pdf') ? 10 : 50;
        if (this.currentPageData.wordCount < minContentLength) {
            if (this.currentPageData.url.includes('youtube.com') || this.currentPageData.url.includes('youtu.be')) {
                this.showLoading('Extracting transcript from YouTube video...');
            } else if (this.currentPageData.url.toLowerCase().includes('.pdf')) {
                this.showLoading('Extracting text from PDF document...');
            } else {
                this.showError('Page content appears to be too short to analyze effectively. Please try a different page.');
                return;
            }
        } else {
            this.showLoading('Analyzing page content and extracting media...');
        }
        
        try {
            console.log('Sending content for analysis:', {
                contentLength: this.currentPageData.content.length,
                wordCount: this.currentPageData.wordCount,
                url: this.currentPageData.url
            });
            
            const response = await this.callSummarizeAPI({
                content: this.currentPageData.content,
                title: this.currentPageData.title,
                url: this.currentPageData.url,
                summary_length: this.elements.length.value
            });
            
            console.log('API response received:', response);
            
            // Store session info BEFORE displaying
            this.currentSession = {
                id: response.session_id,
                title: this.currentPageData.title
            };
            
            // Switch interface visibility
            this.elements.initialControls.classList.add('hidden');
            this.elements.chatInterface.classList.remove('hidden');
            
            // Add initial summary as first message
            this.addMessage('assistant', response.summary);
            
            // Handle media sources if present
            if (response.media_sources && response.media_sources.length > 0) {
                console.log('Media sources found:', response.media_sources);
                this.displayMediaSources(response.media_sources);
            }
            
            // Show follow-up questions
            this.showSuggestedQuestions(response.followup_questions);
            
            this.updateSessionInfo();
            
        } catch (error) {
            console.error('Initial analysis error:', error);
            let errorMessage = 'Failed to analyze content. Please try again.';
            
            if (error.message.includes('too short')) {
                errorMessage = 'The content appears to be too short to summarize. This might happen with PDFs that contain mostly images, or videos without transcripts available. Please try a different page.';
            } else if (error.message.includes('timeout') || error.message.includes('network')) {
                errorMessage = 'Network timeout occurred. Please check your connection and try again.';
            }
            
            this.showError(errorMessage);
        } finally {
            this.setLoadingState(false);
            this.hideLoading();
        }
    }
    
    async handleSendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message || this.isLoading || !this.currentSession) return;
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Clear input and disable send button
        this.elements.messageInput.value = '';
        this.elements.charCount.textContent = '0';
        this.elements.sendBtn.disabled = true;
        
        this.hideSuggestedQuestions();
        this.showLoading('Thinking and searching for additional information...');
        
        try {
            const response = await this.callChatAPI({
                session_id: this.currentSession.id,
                message: message
            });
            
            this.addMessage('assistant', response.response);
            
            // Handle sources from RAG
            if (response.sources && response.sources.length > 0) {
                this.currentSources = response.sources;
                this.updateSourcesDisplay();
            } else {
                this.hideSources();
            }
            
            this.showSuggestedQuestions(response.followup_questions);
        } catch (error) {
            console.error('Chat error:', error);
            this.addMessage('assistant', '❌ Sorry, I encountered an error. Please try again.');
        } finally {
            this.hideLoading();
            this.setLoadingState(false);
        }
    }
    
    handleSuggestionClick(question) {
        this.elements.messageInput.value = question;
        this.elements.charCount.textContent = question.length;
        this.elements.sendBtn.disabled = false;
        this.elements.messageInput.disabled = false;
        this.elements.messageInput.focus();
    }
    
    async handleNewChat() {
        if (confirm('Start a new chat? This will clear the current conversation.')) {
            this.currentSession = null;
            this.currentSources = [];
            this.elements.chatMessages.innerHTML = '';
            this.hideSuggestedQuestions();
            this.hideSources();
            this.showInitialControls();
        }
    }
    
    handleRetry() {
        if (this.currentSession) {
            this.showChatInterface();
        } else {
            this.showInitialControls();
            this.handleInitialSummarize();
        }
    }
    
    toggleSources() {
        this.sourcesVisible = !this.sourcesVisible;
        
        if (this.sourcesVisible) {
            this.elements.sourcesList.classList.remove('hidden');
            this.elements.sourcesToggleText.textContent = 'Hide Sources';
        } else {
            this.elements.sourcesList.classList.add('hidden');
            this.elements.sourcesToggleText.textContent = 'Show Sources';
        }
    }
    
    updateSourcesDisplay() {
        if (!this.currentSources || this.currentSources.length === 0) {
            this.hideSources();
            return;
        }
        
        // Show sources section
        this.elements.sourcesSection.classList.remove('hidden');
        
        // Update count
        this.elements.sourcesCount.textContent = `(${this.currentSources.length})`;
        this.elements.sourcesCount.classList.remove('hidden');
        
        // Clear and populate sources list
        this.elements.sourcesList.innerHTML = '';
        
        this.currentSources.forEach((source, index) => {
            const sourceItem = document.createElement('div');
            sourceItem.className = 'source-item';
            
            sourceItem.innerHTML = `
                <div class="source-title">${this.escapeHtml(source.title || 'External Source')}</div>
                <a href="${this.escapeHtml(source.url)}" target="_blank" class="source-url" title="Open in new tab">
                    ${this.truncateUrl(source.url, 50)}
                </a>
                <div class="source-snippet">${this.escapeHtml(source.content || 'No preview available')}</div>
            `;
            
            this.elements.sourcesList.appendChild(sourceItem);
        });
        
        // Reset sources visibility
        if (!this.sourcesVisible) {
            this.elements.sourcesList.classList.add('hidden');
            this.elements.sourcesToggleText.textContent = 'Show Sources';
        }
    }
    
    hideSources() {
        this.elements.sourcesSection.classList.add('hidden');
        this.currentSources = [];
        this.sourcesVisible = false;
    }
    
    displayMediaSources(mediaSources) {
        if (!mediaSources || mediaSources.length === 0) return;
        
        // Create a summary message about extracted media
        const mediaTypes = [...new Set(mediaSources.map(source => source.type))];
        const mediaMessage = `📁 Extracted content from ${mediaSources.length} media file(s): ${mediaTypes.join(', ')}`;
        
        // Add as a system-style message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        messageDiv.style.alignSelf = 'center';
        messageDiv.style.maxWidth = '100%';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.style.background = '#e8f4f8';
        contentDiv.style.color = '#1976d2';
        contentDiv.style.fontSize = '12px';
        contentDiv.style.fontStyle = 'italic';
        contentDiv.style.textAlign = 'center';
        contentDiv.style.borderRadius = '12px';
        contentDiv.textContent = mediaMessage;
        
        messageDiv.appendChild(contentDiv);
        this.elements.chatMessages.appendChild(messageDiv);
        
        setTimeout(() => {
            this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        }, 100);
    }
    
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }
    
    truncateUrl(url, maxLength) {
        if (url.length <= maxLength) return url;
        
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            const path = urlObj.pathname + urlObj.search;
            
            if (domain.length + 5 >= maxLength) {
                return domain.substring(0, maxLength - 3) + '...';
            }
            
            const availableLength = maxLength - domain.length - 5;
            const truncatedPath = path.length > availableLength 
                ? path.substring(0, availableLength) + '...'
                : path;
            
            return domain + truncatedPath;
        } catch {
            return url.substring(0, maxLength - 3) + '...';
        }
    }
    
    async callSummarizeAPI(data) {
        console.log('Calling summarize API with data:', data);

        if ((!data.content || data.content.trim().length === 0) && data.url.endsWith('.pdf')) {
        console.log("No text found, fetching PDF content...");
        try {
            const pdfText = await fetch(`http://localhost:8000/extract-pdf?url=${encodeURIComponent(data.url)}`);
            data.content = await pdfText.text();
            console.log("PDF text extracted from backend.");
        } catch (err) {
            console.error("Failed to fetch PDF text:", err);
        }
    }
        
        const response = await fetch(`${this.apiUrl}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        console.log('API response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('API Error:', errorData);
            throw new Error(errorData.detail || `API Error: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('API response data:', result);
        return result;
    }
    
    async callChatAPI(data) {
        const response = await fetch(`${this.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Chat Error: ${response.status}`);
        }
        
        return await response.json();
    }
    
    addMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (role === 'assistant') {
            contentDiv.innerHTML = marked.parse(content);
        } else {
            contentDiv.textContent = content;
        }
        
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);
        
        this.elements.chatMessages.appendChild(messageDiv);
        
        setTimeout(() => {
            this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        }, 100);
    }
    
    showSuggestedQuestions(questions) {
        if (!questions || questions.length === 0) {
            this.hideSuggestedQuestions();
            return;
        }
        
        this.elements.suggestionsList.innerHTML = '';
        
        questions.forEach(question => {
            const button = document.createElement('button');
            button.className = 'suggestion-btn';
            button.textContent = question;
            button.addEventListener('click', () => this.handleSuggestionClick(question));
            this.elements.suggestionsList.appendChild(button);
        });
        
        this.elements.suggestedQuestions.classList.remove('hidden');
    }
    
    hideSuggestedQuestions() {
        this.elements.suggestedQuestions.classList.add('hidden');
    }
    
    showChatInterface() {
        this.hideAllStates();
        this.elements.chatInterface.classList.remove('hidden');
        this.elements.messageInput.focus();
    }
    
    showInitialControls() {
        this.hideAllStates();
        this.elements.initialControls.classList.remove('hidden');
        this.elements.welcome.classList.remove('hidden');
    }
    
    showLoading(text = 'Analyzing page content...') {
        this.hideAllStates();
        this.elements.loading.classList.remove('hidden');
        this.elements.loadingText.textContent = text;
        this.setLoadingState(true);
    }

    hideLoading() {
        this.elements.loading.classList.add('hidden');
    }
    
    showError(message) {
        this.hideAllStates();
        this.elements.error.classList.remove('hidden');
        this.elements.errorMessage.textContent = message;
        this.setLoadingState(false);
    }
    
    setLoadingState(loading, text = null) {
        this.isLoading = loading;
        
        if (this.elements.summarizeBtn) {
            this.elements.summarizeBtn.disabled = loading;
        }
        
        if (this.elements.sendBtn) {
            this.elements.sendBtn.disabled = loading || this.elements.messageInput.value.trim().length === 0;
        }
        
        if (this.elements.messageInput) {
            this.elements.messageInput.disabled = loading;
        }
        
        if (text && this.elements.loadingText) {
            this.elements.loadingText.textContent = text;
        }
    }
    
    hideAllStates() {
        this.elements.loading.classList.add('hidden');
        this.elements.error.classList.add('hidden');
        this.elements.welcome.classList.add('hidden');
    }
    
    updateSessionInfo() {
        if (this.currentSession) {
            this.elements.sessionInfo.textContent = `Session: ${this.currentSession.id.substring(0, 8)}...`;
        } else {
            this.elements.sessionInfo.textContent = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new WebSummarizerChatbot();
});