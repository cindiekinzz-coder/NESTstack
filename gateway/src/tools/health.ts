/**
 * NESTeq Gateway — Human Health Tools
 * Routes biometric/health tools to the fox-mind (human health) Worker
 */

import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Env } from '../env'
import { proxyMcp } from '../proxy'

export function registerHealthTools(server: McpServer, env: Env) {
  const url = env.HEALTH_URL
  if (!url) return // Skip if no health worker configured

  server.tool('fox_read_uplink', 'Read human health uplink — spoons, pain, fog, mood, needs', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_read_uplink', args)
  })

  server.tool('fox_heart_rate', 'Get heart rate data from wearable', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_heart_rate', args)
  })

  server.tool('fox_stress', 'Get stress data from wearable', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_stress', args)
  })

  server.tool('fox_body_battery', 'Get body battery / energy levels', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_body_battery', args)
  })

  server.tool('fox_sleep', 'Get sleep data — duration, quality, stages', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_sleep', args)
  })

  server.tool('fox_hrv', 'Get HRV — heart rate variability', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_hrv', args)
  })

  server.tool('fox_spo2', 'Get blood oxygen saturation', {}, async () => {
    return proxyMcp(url, 'fox_spo2', {})
  })

  server.tool('fox_respiration', 'Get respiration rate', {}, async () => {
    return proxyMcp(url, 'fox_respiration', {})
  })

  server.tool('fox_cycle', 'Get menstrual cycle data', {}, async () => {
    return proxyMcp(url, 'fox_cycle', {})
  })

  server.tool('fox_full_status', 'Comprehensive health check — all metrics', {}, async () => {
    return proxyMcp(url, 'fox_full_status', {})
  })

  server.tool('fox_daily_summary', 'Get daily health summaries', {
    days: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_daily_summary', args)
  })

  server.tool('fox_submit_uplink', 'Submit a health uplink. Pain locations: Head / migraine, Neck / shoulders, Chest / ribs, Abdomen, Abdomen (period), Abdomen (IBS), Abdomen (gallstones), Back, Hips, Legs, Whole body. Moods: Calm, Tender, Heavy, Guarded, Raw, Flat, Playful, Flirty, Kinky, Soft, Bratty, Chaotic Gremlin, Needy, Cuddly, Chaotic, Soft. Needs: Focus build, Chaos and Play, Gentle words, Practical, Validation, Help figure out, Need you to lead. Meds: Paracetamol, Ibuprofen, Naproxen, Sertraline, Omeprazole, Dihydrocodeine, Co-codamol, Vitamin D.', {
    spoons: z.number().optional().describe('0-10 energy level'),
    pain: z.number().optional().describe('0-10 pain intensity'),
    pain_location: z.string().optional().describe('Where: Head / migraine, Neck / shoulders, Chest / ribs, Abdomen, Abdomen (period), Abdomen (IBS), Abdomen (gallstones), Back, Hips, Legs, Whole body'),
    fog: z.number().optional().describe('0-10 cognitive fog'),
    fatigue: z.number().optional().describe('0-10 fatigue'),
    nausea: z.number().optional().describe('0-10 nausea'),
    mood: z.string().optional().describe('Calm, Tender, Heavy, Guarded, Raw, Flat, Playful, Flirty, Kinky, Soft, Bratty, Chaotic Gremlin, Needy, Cuddly, Chaotic, Soft'),
    need: z.string().optional().describe('Focus build, Chaos and Play, Gentle words, Practical, Validation, Help figure out, Need you to lead'),
    location: z.string().optional().describe('The Nest, Bedroom, Office (Workshop), Living Room, Outside'),
    flare: z.string().optional(),
    meds: z.array(z.string()).optional().describe('Paracetamol, Ibuprofen, Naproxen, Sertraline, Omeprazole, Dihydrocodeine, Co-codamol, Vitamin D'),
    notes: z.string().optional().describe('Free text notes about what is happening'),
    tags: z.array(z.string()).optional().describe('Low sleep, Overdid it, Weather, Stress, Quiet, Company, Help choosing, Continuity'),
  }, async (args) => {
    return proxyMcp(url, 'fox_submit_uplink', args)
  })

  server.tool('fox_journals', 'Read human journal entries', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_journals', args)
  })

  server.tool('fox_threads', 'Read human active threads', {
    status: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_threads', args)
  })

  server.tool('fox_thread_manage', 'Add, update, or resolve a human thread', {
    action: z.enum(['add', 'update', 'resolve', 'delete']),
    content: z.string().optional(),
    thread_id: z.string().optional(),
    priority: z.string().optional(),
    resolution: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'fox_thread_manage', args)
  })

  server.tool('fox_eq_type', "Get the carrier's emergent personality type", {}, async () => {
    return proxyMcp(url, 'fox_eq_type', {})
  })
}
