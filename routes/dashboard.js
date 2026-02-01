// Dashboard API Routes
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/dashboard
 * Returns stats and data for the dashboard
 */
router.get('/api/dashboard', async (req, res) => {
  try {
    // Get all timers
    const allTimers = await db.getAllActiveTimers().catch(() => []);
    
    // Get all role status schedules
    const schedules = await db.query(
      'SELECT * FROM rolestatus_schedules WHERE enabled = true'
    ).then(result => result.rows).catch(() => []);

    // Get all autopurge settings
    const autopurges = await db.query(
      'SELECT * FROM autopurge_settings WHERE enabled = true'
    ).then(result => result.rows).catch(() => []);

    // Format timers for display
    const formattedTimers = allTimers.map(timer => {
      const remaining = Math.max(0, Number(timer.expires_at) - Date.now());
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

      return {
        user: `<@${timer.user_id}>`,
        role: `<@&${timer.role_id}>`,
        remaining: remaining,
        formattedTime: `${hours}h ${minutes}m ${seconds}s`,
        expiresAt: timer.expires_at,
        paused: timer.paused,
      };
    });

    // Format schedules for display
    const formattedSchedules = schedules.map(schedule => {
      const lastReport = schedule.last_report_at 
        ? new Date(schedule.last_report_at).toLocaleString()
        : 'Never';
      
      const nextReportMs = schedule.last_report_at 
        ? new Date(schedule.last_report_at).getTime() + (schedule.interval_minutes * 60 * 1000)
        : Date.now() + (schedule.interval_minutes * 60 * 1000);
      
      const nextReport = new Date(nextReportMs).toLocaleString();

      return {
        role: `<@&${schedule.role_id}>`,
        channel: `<#${schedule.channel_id}>`,
        interval: schedule.interval_minutes,
        lastReport: lastReport,
        nextReport: nextReport,
      };
    });

    // Format autopurge settings for display
    const formattedAutopurge = autopurges.map(setting => {
      const lastPurge = setting.last_purge_at
        ? new Date(setting.last_purge_at).toLocaleString()
        : 'Never';

      return {
        channel: `<#${setting.channel_id}>`,
        type: setting.type,
        lines: setting.lines,
        interval: Math.ceil(setting.interval_seconds / 60),
        lastPurge: lastPurge,
      };
    });

    // Build response
    const response = {
      botStatus: 'online',
      stats: {
        activeTimers: allTimers.length,
        scheduledReports: schedules.length,
        autopurgeSettings: autopurges.length,
      },
      timers: formattedTimers,
      reports: formattedSchedules,
      autopurge: formattedAutopurge,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({
      error: 'Failed to load dashboard data',
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
