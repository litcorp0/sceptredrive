import { Link, useRouter } from "@tanstack/react-router"
import { ChevronDownIcon, KeyRoundIcon, LogOutIcon, ShieldCheckIcon } from "lucide-react"
import { Button } from "#/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu"
import type { Session } from "#/lib/auth-client"
import { authClient } from "#/lib/auth-client"

export function UserMenu({ session }: { session: Session }) {
	const router = useRouter()

	async function handleSignOut() {
		await authClient.signOut()
		await router.invalidate()
		router.history.push("/login")
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="gap-1.5">
					<span className="max-w-40 truncate">{session.user.name}</span>
					<ChevronDownIcon className="size-3.5 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel className="font-normal">
					<p className="truncate text-sm font-medium">{session.user.name}</p>
					<p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{session.user.staffId ? `${session.user.staffId} · ` : ""}
						{session.user.role}
					</p>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/change-password" className="cursor-pointer">
						<KeyRoundIcon className="size-4" />
						Change password
					</Link>
				</DropdownMenuItem>
				{session.user.twoFactorEnabled !== true ? (
					<DropdownMenuItem asChild>
						<Link to="/two-factor" className="cursor-pointer">
							<ShieldCheckIcon className="size-4" />
							Set up two-factor
						</Link>
					</DropdownMenuItem>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="cursor-pointer"
					onSelect={() => {
						void handleSignOut()
					}}
				>
					<LogOutIcon className="size-4" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
