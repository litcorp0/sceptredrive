import type { Hook } from '@hono/zod-validator'
import { zValidator } from '@hono/zod-validator'
import type { Env, ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { ValidationError } from './errors.ts'

interface IssueLike {
  path: readonly PropertyKey[]
  message: string
}

interface ErrorLike {
  issues: readonly IssueLike[]
}

export function validationErrorFrom(error: ErrorLike): ValidationError {
  const issue = error.issues[0]
  const path = issue?.path.join('.') ?? ''
  const message = path
    ? `${path}: ${issue?.message ?? 'invalid value'}`
    : (issue?.message ?? 'Invalid request')
  return new ValidationError(message)
}

const throwInvalid: Hook<unknown, Env, string, keyof ValidationTargets> = (result) => {
  if (!result.success) throw validationErrorFrom(result.error)
}

export const validateJson = <S extends ZodType>(schema: S) =>
  zValidator('json', schema, throwInvalid)

export const validateQuery = <S extends ZodType>(schema: S) =>
  zValidator('query', schema, throwInvalid)

export const validateParam = <S extends ZodType>(schema: S) =>
  zValidator('param', schema, throwInvalid)
