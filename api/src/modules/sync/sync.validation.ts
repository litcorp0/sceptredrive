import { z } from 'zod'

/**
 * Device endpoints carry no body today: identity is the bearer credential and
 * the device JWT. The schemas live here so the edge contract stays explicit and
 * a future body (e.g. a shift id) is validated the same way as every other route.
 */
export const deviceBearerSchema = z.object({
  authorization: z
    .string()
    .trim()
    .regex(/^Bearer\s+[A-Za-z0-9._~+/-]{1,4096}$/i, 'Expected a Bearer credential'),
})

export type DeviceBearerHeaders = z.infer<typeof deviceBearerSchema>
