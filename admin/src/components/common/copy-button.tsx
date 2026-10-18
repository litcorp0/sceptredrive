import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "#/components/ui/button"

export function CopyButton({
	value,
	label = "Copy",
	className,
}: {
	value: string
	label?: string
	className?: string
}) {
	const [copied, setCopied] = useState(false)

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className={className}
			onClick={() => {
				void navigator.clipboard.writeText(value).then(() => {
					setCopied(true)
					setTimeout(() => setCopied(false), 1500)
				})
			}}
		>
			{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
			{copied ? "Copied" : label}
		</Button>
	)
}
