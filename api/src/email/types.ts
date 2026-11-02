export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailProvider {
  /** `disabled` means production booted without a Resend key; every send throws. */
  readonly name: 'console' | 'resend' | 'file' | 'disabled'
  send(message: EmailMessage): Promise<void>
}
