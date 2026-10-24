import { env } from "#/env"

export class ApiError extends Error {
	readonly status: number
	readonly code: string
	readonly requestId: string | undefined
	readonly details: Record<string, unknown> | undefined

	constructor(
		status: number,
		code: string,
		message: string,
		requestId?: string,
		details?: Record<string, unknown>,
	) {
		super(message)
		this.name = "ApiError"
		this.status = status
		this.code = code
		this.requestId = requestId
		this.details = details
	}
}

type QueryValue = string | number | boolean | undefined

interface RequestOptions {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
	body?: unknown
	query?: Record<string, QueryValue>
	signal?: AbortSignal
	/** Set to false for calls made from the login flow itself. */
	redirectOn401?: boolean
}

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
	const url = new URL(path, env.VITE_API_URL)
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined) continue
			url.searchParams.set(key, String(value))
		}
	}
	return url
}

function currentLocation(): string {
	if (typeof window === "undefined") return "/"
	return window.location.pathname + window.location.search
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const response = await fetch(buildUrl(path, options.query), {
		method: options.method ?? "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
		signal: options.signal,
	})

	if (!response.ok) {
		let envelope:
			| { message?: string; code?: string; requestId?: string; details?: Record<string, unknown> }
			| undefined
		try {
			const payload = (await response.json()) as { error?: typeof envelope } | null
			envelope = payload?.error
		} catch {
			envelope = undefined
		}

		const requestId = envelope?.requestId ?? response.headers.get("x-request-id") ?? undefined

		if (
			response.status === 401 &&
			options.redirectOn401 !== false &&
			typeof window !== "undefined"
		) {
			const redirect = encodeURIComponent(currentLocation())
			window.location.assign(`/login?redirect=${redirect}`)
		}

		throw new ApiError(
			response.status,
			envelope?.code ?? "HTTP_ERROR",
			envelope?.message ?? "Request failed",
			requestId,
			envelope?.details,
		)
	}

	if (response.status === 204) return undefined as T
	return (await response.json()) as T
}

/** True when the API asks for a fresh sign-in before a sensitive action. */
export function isReauthRequired(error: unknown): boolean {
	return error instanceof ApiError && error.code === "REAUTH_REQUIRED"
}
