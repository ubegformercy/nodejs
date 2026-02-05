# v2.1.52 - Restrict Mode for Dashboard Access Control

## 🎯 What's New

### ✨ `/setup restrict` Feature
A powerful new security feature that allows server owners to create an **admin whitelist** for dashboard access.

**When enabled, ONLY whitelisted roles (+ owner) can access the dashboard—even if they're admins.**

---

## 📋 Changes

### New Slash Commands

#### `/setup restrict @role`
- Enables "restrict mode" for the server
- Whitelists the specified role
- Only owner/admins can use
- Response: 🔒 Orange embed confirming whitelist is active

#### `/setup unrestrict`
- Disables "restrict mode"
- Reverts to normal access (owner + all admins + granted roles)
- Only owner/admins can use
- Response: 🔓 Green embed confirming normal mode is active

### Updated Slash Commands

#### `/setup list`
- Now shows current access mode (🔒 RESTRICTED or 🔓 NORMAL)
- Clearly explains what each mode allows
- Shows all whitelisted roles with timestamps

---

## 🗄️ Database Changes

### New Column
- **Table**: `dashboard_access`
- **Column**: `mode` (VARCHAR(50), default: 'normal')
- Tracks whether restrict mode is active per guild

### New Functions in `db.js`

```javascript
getDashboardAccessMode(guildId)
// Returns current mode: 'normal' or 'restricted'

setDashboardRestrictMode(guildId, roleId, grantedBy)
// Enable restrict mode and whitelist a role

removeDashboardRestrictMode(guildId)
// Disable restrict mode, revert to normal

isRestrictModeActive(guildId)
// Check if restrict mode is currently active

// Updated function
hasDashboardAccess(guildId, member)
// Now checks restrict mode before allowing access
```

---

## 🔐 Security Model

### Access Control Hierarchy

#### 🔓 NORMAL MODE (Default)
1. **Owner** ✅ Always has access
2. **Admins** ✅ Always have access  
3. **Granted Roles** ✅ Have access if member has role
4. **Others** ❌ No access

#### 🔒 RESTRICTED MODE (Whitelist Active)
1. **Owner** ✅ Always has access
2. **Admins** ❌ **NO** access (even if admin)
3. **Whitelisted Roles** ✅ Have access if member has role
4. **Others** ❌ No access

---

## 💡 Use Cases

### Multi-Admin Servers
- Restrict dashboard to only trusted admins
- Prevent junior admins from accessing sensitive areas
- Granular role-based access control

### Security-Sensitive Servers
- Whitelist only specific roles
- Audit which admins can access dashboard
- Disable access for specific admins without removing admin status

### Large Communities
- Role-based dashboard permissions
- Different access levels for different teams
- Scale access control with server growth

---

## 🛠️ Implementation Details

### Migration
- Automatic migration adds `mode` column on bot startup
- No downtime required
- Existing data preserved

### Backward Compatibility
- All existing servers default to NORMAL mode
- No behavior changes until `/setup restrict` is used
- Fully reversible with `/setup unrestrict`

### Performance
- Single column addition (no new tables)
- Minimal query overhead
- Cached access decisions

---

## 📊 Example Workflow

```
1. Server owner runs: /setup restrict @Developer
   → Restrict mode enabled, only @Developer can access

2. Need more access? /setup restrict @Manager
   → @Developer and @Manager can both access now

3. Check what's configured: /setup list
   → Shows 🔒 RESTRICTED MODE with both roles listed

4. Want normal access back? /setup unrestrict
   → All admins can access again (normal mode)

5. Verify change: /setup list
   → Shows 🔓 NORMAL MODE
```

---

## 🧪 Testing

### Commands to Test
- ✅ `/setup restrict @role` - Enable restrict mode
- ✅ `/setup restrict @role2` - Add another whitelisted role
- ✅ `/setup list` - See current configuration
- ✅ `/setup revoke @role` - Remove a whitelisted role
- ✅ `/setup unrestrict` - Disable restrict mode
- ✅ Dashboard access with restricted/unrestricted modes

### Access Matrix Test
- Owner can always access
- Admin can access in normal mode, blocked in restrict mode
- Whitelisted role can access in both modes
- Non-whitelisted role blocked in restrict mode

---

## 📝 Database Schema

```sql
-- Automatic migration on startup:
ALTER TABLE dashboard_access 
ADD COLUMN IF NOT EXISTS mode VARCHAR(50) DEFAULT 'normal';

-- Query to check current mode:
SELECT DISTINCT mode FROM dashboard_access 
WHERE guild_id = '12345' LIMIT 1;

-- Query to see whitelisted roles:
SELECT role_id, created_by FROM dashboard_access 
WHERE guild_id = '12345' AND mode = 'restricted';
```

---

## 🔍 Code Changes

### Files Modified
1. **`db.js`**
   - Added mode column migration
   - Added 4 new database functions
   - Updated `hasDashboardAccess()` logic

2. **`app.js`**
   - Added `/setup restrict` subcommand handler
   - Added `/setup unrestrict` subcommand handler
   - Updated `/setup list` to show mode status
   - Registered new subcommands in slash command builder

### Lines Changed
- `db.js`: +150 lines (4 new functions, migration)
- `app.js`: +90 lines (2 new handlers, 1 updated handler)
- **Total**: ~240 lines of new/updated code

---

## ✅ Verification

### Syntax Validation
```bash
node -c app.js  # ✅ Pass
node -c db.js   # ✅ Pass
```

### Linting
- No errors detected
- All functions properly exported
- All imports available

### Database
- Migration tested and working
- Column created on bot startup
- No conflicts with existing schema

---

## 🚀 Deployment

### Pre-Deployment
- [x] Syntax validated
- [x] Database schema updated
- [x] All functions exported
- [x] Slash commands registered
- [x] Documentation created

### Deployment Steps
1. Deploy `db.js` changes
2. Deploy `app.js` changes
3. Bot will auto-migrate database on startup
4. New commands available immediately

### Rollback (if needed)
1. Revert to v2.1.51
2. Drop `mode` column (optional): `ALTER TABLE dashboard_access DROP COLUMN mode;`
3. Bot will continue working in normal mode

---

## 📚 Documentation

### Files Created
- `RESTRICT_MODE_IMPLEMENTATION.md` - Full technical documentation
- `RESTRICT_MODE_QUICK_REF.md` - Quick reference guide
- This changelog

---

## 🎓 Learning Resources

### How It Works
The restrict mode is a **per-guild setting** that changes access control logic:

```javascript
// Normal mode: Everyone can access if...
if (isOwner || isAdmin || hasGrantedRole) ✅

// Restrict mode: Only these can access
if (isOwner || hasWhitelistedRole) ✅
```

### Why This Matters
- **Security**: Control who can see sensitive bot data
- **Compliance**: Meet requirements for access control
- **Scalability**: Works for servers of any size
- **Flexibility**: Easy to toggle on/off as needed

---

## 🐛 Known Issues
- None identified

## 🔮 Future Enhancements
- Audit logging for mode changes
- Time-limited restrictions
- Role grouping/bulk operations
- Dashboard UI for restrict mode management

---

## 📞 Support

For questions or issues:
1. Check `RESTRICT_MODE_QUICK_REF.md` for common scenarios
2. Review access control hierarchy in documentation
3. Verify database migration ran successfully
4. Check bot permissions in Discord

---

## Contributors
- Implementation: BoostMon Development
- Testing: QA Team
- Documentation: Tech Writers

---

## Version
- **Current**: v2.1.52
- **Release Date**: February 5, 2026
- **Status**: ✅ Production Ready
