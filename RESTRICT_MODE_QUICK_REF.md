# 🔒 Restrict Mode Quick Reference

## Commands

### Enable Restrict Mode (Admin Whitelist)
```
/setup restrict @RoleName
```
- Owner/Admin only
- Enables restrict mode
- Whitelists specified role
- Response: 🔒 Orange confirmation

### Add More Whitelisted Roles
```
/setup restrict @AnotherRole
```
- Call multiple times to whitelist more roles
- Each call adds/keeps the role in whitelist

### Disable Restrict Mode (Back to Normal)
```
/setup unrestrict
```
- Owner/Admin only
- Removes restrict mode
- Reverts to normal access (owner + admins)
- Response: 🔓 Green confirmation

### View Current Settings
```
/setup list
```
- Shows current mode (🔒 or 🔓)
- Lists all whitelisted roles
- Shows who granted access and when

---

## Access Rules

### 🔓 NORMAL MODE (Default)
- ✅ **Owner**: Can always access
- ✅ **Admins**: Can always access
- ✅ **Custom Roles**: Can access if granted via `/setup grant`
- ❌ **Others**: No access

### 🔒 RESTRICTED MODE (Whitelist Active)
- ✅ **Owner**: Can always access
- ❌ **Admins**: NO access (even with admin role)
- ✅ **Whitelisted Roles**: Can access (if member has role)
- ❌ **Others**: No access

---

## Example Scenarios

### Scenario 1: Secure Access
```
/setup restrict @Developer
→ Result: Only @Developer members + owner can access
→ All other admins blocked from dashboard
```

### Scenario 2: Multiple Roles
```
/setup restrict @Developer
/setup restrict @Manager
/setup restrict @Moderator
→ Result: All three roles + owner can access
→ All other admins still blocked
```

### Scenario 3: Revert to Normal
```
/setup unrestrict
→ Result: All admins can access again
→ Whitelisted roles still have access
→ Normal access control active
```

---

## Common Tasks

| Task | Command |
|------|---------|
| Whitelist a role | `/setup restrict @Role` |
| Add another role | `/setup restrict @Role2` |
| Remove a whitelisted role | `/setup revoke @Role` |
| See all whitelisted | `/setup list` |
| Turn off whitelist | `/setup unrestrict` |
| Grant access to role | `/setup grant @Role` |
| Revoke access to role | `/setup revoke @Role` |

---

## Who Can Use These Commands?

- ✅ **Server Owner**: Always
- ✅ **Admins**: When NOT in restrict mode
- ✅ **Admins**: When in restrict mode AND whitelisted
- ❌ **Regular Users**: Never
- ❌ **Bots**: Never

---

## Dashboard Access Decision Tree

```
User tries to access dashboard
  ↓
Is user the Server Owner?
  → YES: ✅ ALLOW
  → NO: Continue...
  ↓
Is Restrict Mode Active?
  → NO: Is user an Admin?
      → YES: ✅ ALLOW
      → NO: Does user have granted role?
          → YES: ✅ ALLOW
          → NO: ❌ DENY
  → YES: Does user have whitelisted role?
      → YES: ✅ ALLOW
      → NO: ❌ DENY (even if admin)
```

---

## Database Details

**Table**: `dashboard_access`
**New Column**: `mode` (VARCHAR(50))

| Field | Value | Meaning |
|-------|-------|---------|
| `mode` | `'normal'` | Default - admins auto-allowed |
| `mode` | `'restricted'` | Whitelist mode - only whitelisted roles |

**Query Example**:
```sql
-- Check current mode
SELECT DISTINCT mode FROM dashboard_access 
WHERE guild_id = 'GUILD_ID' LIMIT 1;

-- Lists all whitelisted roles
SELECT role_id, created_by FROM dashboard_access 
WHERE guild_id = 'GUILD_ID';
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Admin can't access in restrict mode | Check if their role is whitelisted with `/setup list` |
| Want to let admins access again | Run `/setup unrestrict` |
| Need to whitelist another admin role | Run `/setup restrict @TheirRole` |
| Restrict mode not working | Check database mode column is set |
| Owner gets blocked | This should NEVER happen - verify owner ID |

---

## Version Info
- **Feature Added**: v2.1.52
- **Database Compatible**: PostgreSQL 12+
- **Status**: ✅ Production Ready

---

## Support
For issues:
1. Run `/setup list` to check current state
2. Verify you have admin/owner permissions
3. Check bot has Manage Roles permission
4. Contact server admin if dashboard not accessible
