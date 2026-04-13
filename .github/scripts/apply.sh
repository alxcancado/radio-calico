#!/usr/bin/env bash
set -e

# Bundle source files
{
  echo "=== index.html ==="
  cat index.html
  echo "=== style.css ==="
  cat style.css
  echo "=== app.js ==="
  cat app.js
  echo "=== api/app.py ==="
  cat api/app.py
} > /tmp/context.txt

CONTEXT=$(cat /tmp/context.txt)

# Build prompt
jq -n \
  --arg title "$ISSUE_TITLE" \
  --arg body "$ISSUE_BODY" \
  --arg context "$CONTEXT" \
  '{
    model: "meta-llama/llama-3.3-70b-instruct:free",
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: "You are an expert developer implementing changes to the Radio Calico web radio player. Respond with ONLY a valid JSON object, no markdown fences, no explanation outside the JSON: {\"branch\":\"fix/short-name\",\"pr_title\":\"Short title\",\"pr_body\":\"What changed and why.\",\"files\":[{\"path\":\"relative/path\",\"content\":\"full file content\"}]} Only include files that need to change. Make minimal focused changes."
      },
      {
        role: "user",
        content: ("Issue: " + $title + "\n\n" + $body + "\n\nSource code:\n" + $context)
      }
    ]
  }' > /tmp/prompt.json

# Call OpenRouter
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/prompt.json > /tmp/response.json

jq -r '.choices[0].message.content' /tmp/response.json > /tmp/patch.json

PATCH=$(cat /tmp/patch.json)
BRANCH=$(echo "$PATCH"   | jq -r '.branch')
PR_TITLE=$(echo "$PATCH" | jq -r '.pr_title')
PR_BODY=$(echo "$PATCH"  | jq -r '.pr_body')

# Configure git
git config user.name  "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git checkout -b "$BRANCH"

# Write each changed file
echo "$PATCH" | jq -c '.files[]' | while IFS= read -r file; do
  FILE_PATH=$(echo "$file"    | jq -r '.path')
  FILE_CONTENT=$(echo "$file" | jq -r '.content')
  mkdir -p "$(dirname "$FILE_PATH")"
  printf '%s' "$FILE_CONTENT" > "$FILE_PATH"
  git add "$FILE_PATH"
done

git commit -m "$PR_TITLE (closes #$ISSUE_NUMBER)"
git push origin "$BRANCH"

gh pr create \
  --title "$PR_TITLE" \
  --body "${PR_BODY}

Closes #${ISSUE_NUMBER}" \
  --head "$BRANCH" \
  --base main

gh issue edit "$ISSUE_NUMBER" --remove-label "ai-pending-review"
gh issue comment "$ISSUE_NUMBER" --body "🤖 Implementation complete — a pull request has been opened for your review."
