#!/bin/bash
# Hook: Validate that commit messages contain AB#XXXX reference
# Used by developers to ensure ADO work item linking

COMMIT_MSG="$1"

if [ -z "$COMMIT_MSG" ]; then
  echo "ERROR: No commit message provided"
  exit 1
fi

# Check for AB# pattern (allows initial commits and merge commits to skip)
if echo "$COMMIT_MSG" | grep -qiE "(^Initial|^Merge|AB#[0-9]+)"; then
  exit 0
else
  echo "WARNING: Commit message should contain AB#XXXX to link to ADO work item"
  echo "Message: $COMMIT_MSG"
  echo "Example: 'AB#32 Implement Tree-sitter parser with WASM bindings'"
  exit 0  # Warning only, don't block
fi
