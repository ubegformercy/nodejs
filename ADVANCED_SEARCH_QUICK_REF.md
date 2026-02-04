# QUICK REFERENCE: Advanced Search

## What Changed
✅ Fixed: `db.query is not a function` error
✅ Added: Search for users by Discord ID or username
✅ Added: Press ENTER to trigger search

## How to Use (3 Steps)

1. Click "Select User" field
2. Type Discord ID or username
3. **Press ENTER** ← This triggers the search

## What Happens

```
User types "123456789012345678"
         ↓
     Press ENTER
         ↓
   System searches in this order:
   1. Discord cache (fastest)
   2. Discord API (if not cached)
   3. Database (for archived users)
         ↓
    Results shown with:
    - User name/ID
    - Status (online/offline)
    - Source (cache/database)
         ↓
   User clicks result → User selected
```

## Examples

| Type This | Press ENTER | Get This |
|-----------|-------------|----------|
| `123456789012345678` | ↵ | Username (online) |
| `john` | ↵ | John#1234 (from timers) |
| `invalid` | ↵ | ❌ User not found |

## Files Modified

- `db.js` → Added query() function
- `routes/dashboard.js` → Added /api/search-user endpoint
- `public/dashboard.html` → Added search UI and Enter handler

## Version

**v2.1.31** - Now on localhost and GitHub

## Status

✅ Localhost: Running
✅ GitHub: Pushed
✅ Railway: Deploying
