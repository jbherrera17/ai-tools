"""POST /api/summarize - Generate AI-powered summaries using Claude.

Request body: {
    "url": "https://example.com/article",
    "type": "tldr" | "executive",
    "title": "Article Title"
}

Response: { "success": true, "summary": "<html>", "error": null }
"""

import json
import os
from http.server import BaseHTTPRequestHandler
import anthropic
import requests
from bs4 import BeautifulSoup

# Anthropic SDK model id (not an AI Gateway string). Override with DIGEST_MODEL.
DIGEST_MODEL = os.environ.get('DIGEST_MODEL') or 'claude-sonnet-4-5-20250929'


def fetch_article_content(url):
    """Fetch and extract main content and metadata from article URL.

    Returns dict with 'text' (article content) and 'metadata' (og:image, title).
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        # Parse HTML
        soup = BeautifulSoup(response.content, 'html.parser')

        # Extract metadata before stripping elements
        metadata = {'title': '', 'openGraphImage': ''}
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            metadata['title'] = og_title['content']
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            metadata['openGraphImage'] = og_image['content']

        # Remove script and style elements
        for script in soup(["script", "style", "nav", "header", "footer", "aside"]):
            script.decompose()

        # Try to find main content
        main_content = None
        for selector in ['article', 'main', '.post-content', '.article-content', '.entry-content']:
            main_content = soup.select_one(selector)
            if main_content:
                break

        if not main_content:
            main_content = soup.find('body')

        # Get text
        text = main_content.get_text(separator='\n', strip=True) if main_content else ''

        # Clean up excessive whitespace
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)

        # Limit to first 4000 words to avoid token limits
        words = text.split()
        if len(words) > 4000:
            text = ' '.join(words[:4000]) + '...'

        return {'text': text, 'metadata': metadata}

    except Exception as e:
        raise Exception(f"Failed to fetch article: {str(e)}")


def strip_code_fences(text):
    """Remove markdown code fences (```html ... ```) from Claude's response."""
    import re
    text = re.sub(r'^```\w*\s*\n?', '', text.strip())
    text = re.sub(r'\n?```\s*$', '', text.strip())
    return text.strip()


def generate_tldr_summary(article_text, title, url):
    """Generate a TL;DR summary using Claude."""
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise Exception("ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""Generate a concise TL;DR summary of this article in HTML format.

Article Title: {title}
Article URL: {url}

Article Content:
{article_text}

Create a brief summary with:
1. A "Quick Summary" section with 3-5 key bullet points
2. Keep it concise - focus on the most important takeaways
3. Use clear, simple language

Format your response as clean HTML with:
- <h4> for section headers
- <ul> and <li> for bullet points
- <p> for paragraphs

IMPORTANT: Return ONLY raw HTML. Do NOT wrap your response in markdown code fences (```). Do not include the article title (it's already shown above your summary).
"""

    message = client.messages.create(
        model=DIGEST_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )

    return strip_code_fences(message.content[0].text)


def generate_executive_summary(article_text, title, url):
    """Generate a structured executive summary as JSON, then render to inline HTML."""
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise Exception("ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""When processing source material, extract and organize all content following these specifications:

1. Initial Content Extraction
- Capture every piece of information from the source exactly as presented
- Do not summarize, interpret, or condense any content
- Maintain all technical terms, numbers, and specific language verbatim
- Include all examples, footnotes, and supplementary information

2. Content Organization
- Create main topic sections using descriptive headings
- Group related information under appropriate sections
- Use nested hierarchies to show relationships between topics
- Maintain original sequence where order is significant

3. Entity Documentation
- List all mentioned:
  - People (names, titles, roles)
  - Organizations
  - Locations
  - Products
  - Technical terms
- Document relationships between entities using structured lists
- Include any provided definitions or descriptions

4. Data Handling
- Record all numbers with their full context
- Maintain original units of measurement
- Preserve statistical relationships and comparisons
- Create tables for structured numerical data
- Keep all decimal places and significant figures as presented

5. Structure Requirements
- Format output as valid JSON
- Include clear section identifiers
- Maintain consistent formatting

6. Action & Decision Capture
- Document all:
  - Procedural steps
  - Recommendations
  - Conclusions
  - Decision points
- Preserve exact sequence and dependencies

7. Output Validation
- Verify all content is present
- Confirm technical accuracy
- Check structural integrity
- Ensure format compliance

Do not add interpretations, summaries, or external context. Present information exactly as provided in the source material.

Here is the content from the page:
Page URL: {url}
Page Title: {title}

Please prioritize summarizing this selected text, while using the page title for context.
Please summarize the full page content:
<full_text>
{article_text}
</full_text>

## output
Output a valid JSON. Use the example JSON below as a guideline for structure. Some additional notes:
- Add as many sections as needed. The example includes different kinds of sections.
- sections must always include "heading"
- sections can optionally include (body, items, entities). You can combine any of these in a section.
- for "body", you can use <br><br> to create line breaks for multiple paragraphs if needed.
- Always include an "SMB Impact" section describing how the subject affects small and medium businesses.

Example JSON:
{{
  "title": "Article Title Here",
  "subtitle": "A concise description of the content, can be a couple sentences long",
  "sections": [
    {{
      "heading": "Introduction",
      "body": "First paragraph of text.<br><br>Second paragraph if needed."
    }},
    {{
      "heading": "Key Topics",
      "body": "Optional intro text for this section.",
      "items": [
        {{"topic": "Topic Name", "details": "Description of this topic."}},
        {{"topic": "Another Topic", "details": "Description of this topic."}}
      ]
    }},
    {{
      "heading": "SMB Impact",
      "body": "How this subject affects small and medium businesses."
    }},
    {{
      "heading": "Entities Involved",
      "body": "Optional intro text.",
      "entities": [
        {{"name": "Company Name", "type": "Company", "relation": "What role they play."}},
        {{"name": "Person Name", "type": "Person", "relation": "Their role and relevance."}}
      ]
    }}
  ]
}}

IMPORTANT: Return ONLY valid JSON. Do NOT wrap in markdown code fences.
"""

    message = client.messages.create(
        model=DIGEST_MODEL,
        max_tokens=2048,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )

    raw = strip_code_fences(message.content[0].text)
    try:
        summary_json = json.loads(raw)
    except json.JSONDecodeError:
        import re
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            summary_json = json.loads(match.group())
        else:
            raise Exception("Failed to parse structured summary from Claude response")
    return render_executive_html(summary_json)


def render_executive_html(data):
    """Render executive summary JSON into inline HTML for the modal."""
    from html import escape

    html = ''

    # Subtitle
    if data.get('subtitle'):
        html += f'<p style="color: #555; font-style: italic; margin-bottom: 16px;">{data["subtitle"]}</p>'

    for section in data.get('sections', []):
        heading = escape(section.get('heading', ''))
        html += f'<h4 style="color: #667eea; margin: 20px 0 8px;">{heading}</h4>'

        if section.get('body'):
            html += f'<p style="margin-bottom: 12px;">{section["body"]}</p>'

        if section.get('items'):
            html += '<ul style="padding-left: 20px; margin: 8px 0 12px;">'
            for item in section['items']:
                topic = escape(item.get('topic', ''))
                details = escape(item.get('details', ''))
                html += f'<li style="margin-bottom: 6px;"><strong>{topic}:</strong> {details}</li>'
            html += '</ul>'

        if section.get('entities'):
            for entity in section['entities']:
                etype = escape(entity.get('type', ''))
                ename = escape(entity.get('name', ''))
                erelation = escape(entity.get('relation', ''))
                html += f'''<div style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                    <span style="font-size: 0.7rem; text-transform: uppercase; color: #667eea; font-weight: 600;">{etype}</span>
                    <div style="font-weight: 600;">{ename}</div>
                    <div style="color: #555; font-size: 0.9rem;">{erelation}</div>
                </div>'''

    return html


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}

        url = body.get('url', '')
        summary_type = body.get('type', 'tldr')
        title = body.get('title', 'Article')
        source = body.get('source', '')
        date = body.get('date', '')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if not url:
            self.wfile.write(json.dumps({
                'success': False,
                'summary': '',
                'error': 'URL is required'
            }).encode())
            return

        try:
            # Fetch article content
            result = fetch_article_content(url)
            article_text = result['text']

            if not article_text:
                raise Exception("No content could be extracted from the article")

            # Generate summary based on type
            if summary_type == 'tldr':
                summary = generate_tldr_summary(article_text, title, url)
            else:
                summary = generate_executive_summary(article_text, title, url)

            # Build article metadata header
            from html import escape
            header = f'<h3 style="margin: 0 0 4px 0; font-size: 1.05rem; color: #333;">{escape(title)}</h3>'
            meta_parts = []
            if source:
                meta_parts.append(f'<span style="font-weight: 600; color: #667eea;">{escape(source)}</span>')
            if date:
                meta_parts.append(f'<span>{escape(date)}</span>')
            if meta_parts:
                header += f'<p style="font-size: 0.8rem; color: #888; margin: 0 0 16px 0;">{" &middot; ".join(meta_parts)}</p>'
            header += '<hr style="border: none; border-top: 1px solid #e9ecef; margin: 0 0 16px 0;">'

            footer = f'''
                <p style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e9ecef; font-size: 0.85rem;">
                    <a href="{url}" target="_blank" style="color: #667eea; text-decoration: none;">Read full article →</a>
                </p>
            '''

            summary = header + summary + footer

            self.wfile.write(json.dumps({
                'success': True,
                'summary': summary,
                'error': None
            }).encode())

        except Exception as e:
            self.wfile.write(json.dumps({
                'success': False,
                'summary': '',
                'error': str(e)
            }).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
