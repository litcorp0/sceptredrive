import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { type Theme, useTheme } from "#/components/theme-provider"
import { Button } from "#/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu"

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
	{ value: "light", label: "Light", icon: SunIcon },
	{ value: "dark", label: "Dark", icon: MoonIcon },
	{ value: "system", label: "System", icon: MonitorIcon },
]

export function ThemeToggle() {
	const { theme, setTheme } = useTheme()

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Theme"
					className="text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground"
				>
					<SunIcon aria-hidden="true" className="size-4 dark:hidden" />
					<MoonIcon aria-hidden="true" className="hidden size-4 dark:block" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36">
				<DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
					{THEME_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value}>
							<option.icon aria-hidden="true" className="size-4 text-muted-foreground" />
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
