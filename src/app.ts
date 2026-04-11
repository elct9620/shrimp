import { Hono } from 'hono'
import { createHealthRoute } from './adapters/http/routes/health'

export const app = new Hono()

app.route('/', createHealthRoute())
