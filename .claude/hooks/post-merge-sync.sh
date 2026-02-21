#!/bin/bash
# Hook: After merge to main, remind to sync ADO
# This is a notification hook - it doesn't auto-update ADO

echo ""
echo "=== Post-Merge Reminder ==="
echo "Branch merged to main. Remember to:"
echo "  1. Run /scrum-master sync to update ADO work item states"
echo "  2. Run pnpm test to verify integration"
echo "  3. Check for any merge conflicts in other active branches"
echo "==========================="
echo ""
