# /register Command - Quick Reference

## 🎯 Commands

### For Members (Everyone)
```
/register in-game <username> <display>
```
**Example**: `/register in-game MyGameName "Cool Player"`

### For Admins/Owner
```
/register user @user <username> <display>
```
**Example**: `/register user @newmember GameAccount "Game Display"`

---

## 🔐 Permissions

| Command | Who Can Use | Purpose |
|---------|-------------|---------|
| `/register in-game` | Everyone | Register yourself |
| `/register user` | Admin + Owner Only | Register anyone (with admin approval) |

---

## 📊 Command Flow

### Member Registration
```
1. Member types: /register in-game MyGame "My Name"
2. Bot checks: (no permission needed)
3. Bot stores: Discord ID + Game Info
4. Bot shows: ✅ Registration Complete
```

### Admin Registration
```
1. Admin types: /register user @member MyGame "My Name"
2. Bot checks: Is sender admin? ✓
3. Bot stores: Discord ID + Game Info
4. Bot shows: ✅ User Registered + "Registered By: @admin"
```

---

## 💾 What Gets Stored

For each registration:
- Discord User ID
- Discord Username
- In-Game Username
- Display Name
- Guild ID
- Who registered them
- When registered (timestamp)

---

## ⚠️ Key Security Features

✅ Members can only register themselves  
✅ Members cannot change their own or others' names manually after registration  
✅ Only admins can register other users  
✅ Database enforces one registration per user per guild  
✅ Updates automatically if user re-registers  

---

## 🎨 Success Response

Both commands show a beautiful embed:
```
✅ Registration Complete
━━━━━━━━━━━━━━━━━━━━━
Discord User: @yourname
In-Game Username: GameName
Display Name: My Cool Name
[Registered By: @admin] ← (only shown in admin subcommand)
```

---

## ❌ Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Permission Denied" | Non-admin tried `/register user` | Use `/register in-game` instead |
| "Failed to register" | Database error | Try again or contact admin |
| "Not in a server" | Used in DMs | Use in a server channel |

---

## 🧪 Quick Test

**Test 1 - Member Registration**
```
/register in-game TestGame "Test Name"
→ Should show: ✅ Registration Complete
→ No "Registered By" field
```

**Test 2 - Admin Registration**
```
/register user @testmember TestGame "Test Name"
→ Should show: ✅ User Registered
→ Shows "Registered By: @you"
```

**Test 3 - Unauthorized Access**
```
(As regular member)
/register user @someone GameName "Name"
→ Should show: ⛔ Permission Denied
```

---

## 📝 Notes

- Each user can only have one registration per guild
- Re-running the command updates the existing registration
- Display names are optional but encouraged for clarity
- Admin registration can be used to fix user entries

---

**Version**: 2.1.170+  
**Status**: ✅ Live and Tested
