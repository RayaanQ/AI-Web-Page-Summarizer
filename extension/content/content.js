//Content Script file that runs on all web pages to provide content extraction capabilities. Enhanced content extraction utility and Provides better content detection and cleaning

(function() {
    'use strict';
    

    class ContentExtractor {
        constructor() {
            this.readabilitySelectors = [
                // Common article containers
                'article',
                'main',
                '[role="main"]',
                '.post-content',
                '.entry-content', 
                '.article-content',
                '.content-body',
                '.story-content',
                '.post-body',
                
                // News sites
                '.article-body',
                '.story-body',
                '.entry-body',
                '.content-wrapper',
                
                // Blog platforms
                '.post-container',
                '.blog-content',
                '.entry-wrapper'
            ];
            
            this.excludeSelectors = [
                'script',
                'style',
                'nav',
                'header',
                'footer',
                'aside',
                'form',
                'button',
                '.advertisement',
                '.ads',
                '.ad-container',
                '.sidebar',
                '.navigation',
                '.menu',
                '.comments',
                '.comment-section',
                '.social-share',
                '.related-posts',
                '.author-bio',
                '.newsletter-signup',
                '[role="navigation"]',
                '[role="banner"]',
                '[role="contentinfo"]',
                '[role="complementary"]'
            ];
        }
        
        //Extract and clean text content from element
        extractTextFromElement(element) {
            if (!element) return '';
            
            const clone = element.cloneNode(true);
            
            // Remove excluded elements
            this.excludeSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => el.remove());
            });
            
            // Get text content
            let text = clone.innerText || clone.textContent || '';
            
            // Clean up text
            text = text
                .replace(/\s+/g, ' ')           // Multiple spaces to single space
                .replace(/\n\s*\n/g, '\n\n')    // Multiple newlines to double newline
                .replace(/\t/g, ' ')            // Tabs to spaces
                .trim();
            
            return text;
        }
        
        //Calculate content score based on various factors

        calculateContentScore(element) {
            if (!element) return 0;
            
            const text = this.extractTextFromElement(element);
            const textLength = text.length;
            
            if (textLength < 100) return 0;
            
            let score = textLength;
            
            // Boost score for semantic elements
            const tagName = element.tagName.toLowerCase();
            const semanticBonus = {
                'article': 200,
                'main': 150,
                'section': 100
            };
            
            if (semanticBonus[tagName]) {
                score += semanticBonus[tagName];
            }
            
            // Boost for content-related classes and IDs
            const classList = element.className.toLowerCase();
            const id = element.id.toLowerCase();
            const contentKeywords = ['content', 'article', 'post', 'story', 'entry', 'body', 'text'];
            
            contentKeywords.forEach(keyword => {
                if (classList.includes(keyword) || id.includes(keyword)) {
                    score += 100;
                }
            });
            
            // Penalty for likely non-content elements
            const negativeKeywords = ['sidebar', 'navigation', 'menu', 'ad', 'comment', 'footer', 'header'];
            negativeKeywords.forEach(keyword => {
                if (classList.includes(keyword) || id.includes(keyword)) {
                    score -= 200;
                }
            });
            
            // Penalty for too many links (likely navigation)
            const links = element.querySelectorAll('a');
            const linkRatio = links.length / (text.split(' ').length || 1);
            if (linkRatio > 0.1) {
                score -= linkRatio * 500;
            }
            
            return Math.max(0, score);
        }
        
        //Find the best content element on the page
        
        findBestContentElement() {
            const candidates = [];
            
            // Try readability selectors first
            for (const selector of this.readabilitySelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    const score = this.calculateContentScore(element);
                    if (score > 0) {
                        candidates.push({ element, score });
                    }
                });
            }
            
            // If no good candidates, try common containers
            if (candidates.length === 0) {
                const fallbackSelectors = ['div', 'section', 'main'];
                
                fallbackSelectors.forEach(tagName => {
                    const elements = document.querySelectorAll(tagName);
                    elements.forEach(element => {
                        const score = this.calculateContentScore(element);
                        if (score > 500) { // Higher threshold for generic elements
                            candidates.push({ element, score });
                        }
                    });
                });
            }
            
            // Sort by score and return the best
            if (candidates.length > 0) {
                candidates.sort((a, b) => b.score - a.score);
                return candidates[0].element;
            }
            
            // Final fallback to body
            return document.body;
        }
        
        //Extract comprehensive page content
        extractPageContent() {
            const contentElement = this.findBestContentElement();
            const content = this.extractTextFromElement(contentElement);
            
            // Get additional metadata
            const title = document.title || 'Untitled Page';
            const url = window.location.href;
            
            // Meta description
            const metaDescription = document.querySelector('meta[name="description"]');
            const description = metaDescription ? metaDescription.getAttribute('content') : '';
            
            // Open Graph data
            const ogTitle = document.querySelector('meta[property="og:title"]');
            const ogDescription = document.querySelector('meta[property="og:description"]');
            
            // Article metadata
            const articleAuthor = document.querySelector('meta[name="author"]') || 
                                document.querySelector('[rel="author"]') ||
                                document.querySelector('.author');
            
            const publishDate = document.querySelector('meta[property="article:published_time"]') ||
                              document.querySelector('time[datetime]') ||
                              document.querySelector('.date');
            
            return {
                title: ogTitle ? ogTitle.getAttribute('content') : title,
                url,
                content,
                description: ogDescription ? ogDescription.getAttribute('content') : description,
                author: articleAuthor ? (articleAuthor.textContent || articleAuthor.getAttribute('content')) : null,
                publishDate: publishDate ? (publishDate.getAttribute('datetime') || publishDate.textContent) : null,
                wordCount: content.split(/\s+/).filter(word => word.length > 0).length,
                characterCount: content.length,
                domain: window.location.hostname,
                timestamp: new Date().toISOString(),
                language: document.documentElement.lang || 'en'
            };
        }
    }
    
    // Create global instance
    window.aiWebSummarizerExtractor = new ContentExtractor();
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'extractContent') {
            try {
                const pageData = window.aiWebSummarizerExtractor.extractPageContent();
                sendResponse({ success: true, data: pageData });
            } catch (error) {
                console.error('Content extraction error:', error);
                sendResponse({ success: false, error: error.message });
            }
        }
        return true; // Keep message channel open for async response
    });
    
    // Signal that content script is ready
    chrome.runtime.sendMessage({ 
        action: 'contentScriptReady',
        url: window.location.href 
    }).catch(() => {
        // Ignore errors if background script isn't ready
    });
    
})();