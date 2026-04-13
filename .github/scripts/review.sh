#!/usr/bin/env bash
set -e

# Build prompt
jq -n \
  --arg title "$ISSUE_TITLE" \
  --arg body "$ISSUE_BODY" \
  --arg repo "$REPO" \
  '{
    model: "meta-llama/llama-3.3-70b-instruct:free",
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content: ("You are a code reviewer for the Radio Calico web radio player project (" + $repo + "). The project is a vanilla HTML/CSS/JS frontend with a Flask+SQLite ratings API. When given a GitHub issue: 1) Summarise what is being requested. 2) Assess feasibility and impact. 3) Describe exactly what files and changes would be needed. 4) Flag any risks. Be concise and technical. End with either RECOMMENDATION: APPROVE or RECOMMENDATION: REJECT with a one-line reason.")
      },
      {
        role: "user",
        content: ("Issue title: " + $title + "\n\nIssue body:\n" + $body)
      }
    ]
  }' > /tmp/prompt.json

# Call OpenRouter
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/prompt.json > /tmp/response.json

# Extract reply
REPLY=$(jq -r '.choices[0].message.content // "LLM response unavailable."' /tmp/response.json)

# Post comment
COMMENT="## 🤖 AI Review

${REPLY}

---
*To approve, add the label \`ai-approved\`. To reject, add \`ai-rejected\`.*"

gh issue comment "$ISSUE_NUMBER" --body "$COMMENT"

# Create labels (ignore errors if they already exist)
gh label create "ai-pending-review" --color "e4e669" --description "Awaiting maintainer decision" 2>/dev/null || true
gh label create "ai-approved"       --color "0e8a16" --description "Approved for AI implementation" 2>/dev/null || true
gh label create "ai-rejected"       --color "d93f0b" --description "Rejected by maintainer" 2>/dev/null || true

gh issue edit "$ISSUE_NUMBER" --add-label "ai-pending-review"
