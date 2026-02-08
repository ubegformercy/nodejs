# Database Constraints & Duplicate Prevention - Quick Reference

## What You Asked

**"I'm trying to add and it says there's something still there"**

---

## What That Means

The database has **UNIQUE constraints** (rules) that prevent you from creating duplicate entries for the same channel or role+channel combination.

---

## The Rules

### Rule 1: Autopurge Settings
**One autopurge setting per channel per guild**

```
UNIQUE(guild_id, channel_id)
```

| Guild | Channel | Status |
|-------|---------|--------|
| Guild123 | #general | ✅ Has autopurge |
| Guild123 | #general | ❌ CANNOT add another |
| Guild123 | #announcements | ✅ Can add (different channel) |

**Error when you try**: 
```
409 Conflict: An auto-purge setting already exists for this channel
```

---

### Rule 2: Scheduled Reports
**One scheduled report per role+channel combination per guild**

```
UNIQUE(guild_id, role_id, channel_id)
```

| Guild | Role | Channel | Status |
|-------|------|---------|--------|
| Guild123 | @Members | #reports | ✅ Has report |
| Guild123 | @Members | #reports | ❌ CANNOT add another |
| Guild123 | @Members | #audit | ✅ Can add (different channel) |
| Guild123 | @Admins | #reports | ✅ Can add (different role) |

**Error when you try**:
```
409 Conflict: A scheduled report already exists for this role and channel combination
```

---

## What To Do When You Get This Error

### Option 1: Update the Existing One
- Click on a value in the table
- Edit it (interval, lines, type, etc.)
- Changes save instantly

### Option 2: Delete and Create New
1. Click the 🗑️ button to delete the old one
2. Wait for confirmation
3. Add the new one

### Option 3: Use a Different Combination
- For **autopurge**: Choose a different channel
- For **reports**: Choose a different role OR different channel

---

## Why These Constraints Exist

### Prevents Conflicts
Without these rules, you could have:
- ❌ Multiple autopurge rules fighting for the same channel
- ❌ Multiple reports sending duplicate messages to the same channel

### Keeps Data Clean
- ✅ One source of truth per setting
- ✅ No ambiguity about what's actually running
- ✅ Easier to track and manage

### Is Not a Bug
This is **intentional design**, not a limitation to work around.

---

## Visual Guide: The Flow

```
User tries to ADD autopurge for #general
         ↓
System checks: Does #general already have autopurge?
         ↓
    YES → Returns 409 Conflict error
    NO  → Creates new autopurge setting ✓
```

```
User tries to ADD report for @Members in #reports
         ↓
System checks: Does @Members already report to #reports?
         ↓
    YES → Returns 409 Conflict error
    NO  → Creates new report ✓
```

---

## API Responses

### Successful Add
```json
{
  "success": true,
  "setting": { /* the new setting */ },
  "message": "Auto-purge setting created successfully"
}
```

### Duplicate Error
```json
{
  "error": "An auto-purge setting already exists for this channel"
}
```
Status: **409 Conflict**

---

## Current Data in Your Database

### Autopurge Settings (Existing)
| Guild | Channel | Type | Status |
|-------|---------|------|--------|
| 1464047532978995305 | #server-2 | both | ENABLED ✓ |
| 1464047532978995305 | #logs | all | ENABLED ✓ |
| 1464047532978995305 | #dev-channel | both | DISABLED |

**You can:**
- ✅ Add autopurge for any OTHER channel in this guild
- ✅ Update interval/lines for existing ones
- ✅ Delete disabled ones and create new ones
- ❌ Add another for #server-2 (already has one, enabled)

### Scheduled Reports (Existing)
| Guild | Role | Channel | Status |
|-------|------|---------|--------|
| 1464047532978995305 | @role-1 | #reports | ENABLED ✓ |
| 1464047532978995305 | @role-2 | #audit | ENABLED ✓ |
| 1464047532978995305 | @role-3 | #reports | ENABLED ✓ |

**You can:**
- ✅ Add report for any NEW role+channel combination
- ✅ Add report for @role-1 in #audit (different channel)
- ✅ Update interval for existing ones
- ✅ Delete enabled ones and create new ones
- ❌ Add another report for @role-1 → #reports (already exists)

---

## Improved Error Messages

We've updated the error messages to be clearer:

### Before
```
An auto-purge setting already exists for this channel
```

### After
```
This channel already has an auto-purge setting. 
You can update or delete the existing one instead.
```

---

## Testing It Yourself

### Try Adding a Duplicate (Get Error)
1. Go to **Auto-Purge Settings**
2. Select a channel that already has autopurge
3. Fill in form
4. Click **Add Setting**
5. See the improved error message
6. **This is working correctly!** ✓

### Try Adding Something New (Success)
1. Go to **Auto-Purge Settings**
2. Select a channel that does NOT have autopurge
3. Fill in form
4. Click **Add Setting**
5. **Should work!** ✓

---

## FAQ

**Q: Does this mean the database is broken?**  
A: No! This is working exactly as designed.

**Q: How do I add the same setting to multiple channels?**  
A: Add separate settings for each channel. Each one is independent.

**Q: Can I disable a setting instead of deleting it?**  
A: No, but you can delete and recreate. Currently all settings are either enabled or you delete them.

**Q: What if I really need multiple settings for one channel?**  
A: This design prevents it intentionally. You can have ONE autopurge rule per channel.

---

## Need to Debug?

### Check Browser Console (F12)
- Look for JavaScript errors
- Check XHR/Network tab for API response

### Check Server Logs
```bash
tail -50 /tmp/server.log
```

### Query Database Directly
```bash
# Check autopurge settings
psql $DATABASE_URL -c "SELECT * FROM autopurge_settings WHERE guild_id='1464047532978995305';"

# Check reports
psql $DATABASE_URL -c "SELECT * FROM rolestatus_schedules WHERE guild_id='1464047532978995305';"
```

---

## Summary

✅ **Duplicates are prevented by design**  
✅ **Error messages now explain what to do**  
✅ **Update or delete existing entries if needed**  
✅ **This is working correctly, not a bug**  

Everything is functioning as intended!
