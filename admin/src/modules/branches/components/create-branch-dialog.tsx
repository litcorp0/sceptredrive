import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError } from "#/lib/api"
import { useDebouncedValue } from "#/lib/hooks"
import { toastApiError } from "#/lib/toast"
import { createBranch, suggestBranchCode } from "../api/branches"
import { branchKeys } from "../api/keys"
import type { BranchType } from "../types"

export function CreateBranchDialog({
	open,
	onOpenChange,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const queryClient = useQueryClient()

	const [name, setName] = useState("")
	const [type, setType] = useState<BranchType>("RETAIL")
	const [city, setCity] = useState("")
	const [area, setArea] = useState("")
	const [address, setAddress] = useState("")
	const [phone, setPhone] = useState("")
	const [code, setCode] = useState("")
	const [codeTouched, setCodeTouched] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	const debouncedCity = useDebouncedValue(city, 400)
	const debouncedArea = useDebouncedValue(area, 400)

	useEffect(() => {
		if (codeTouched || debouncedCity.trim().length === 0) return
		let cancelled = false
		void suggestBranchCode({ city: debouncedCity, area: debouncedArea || undefined, type })
			.then((suggestion) => {
				if (!cancelled) setCode(suggestion.code)
			})
			.catch(() => undefined)
		return () => {
			cancelled = true
		}
	}, [debouncedCity, debouncedArea, type, codeTouched])

	const createMutation = useMutation({
		mutationFn: () =>
			createBranch({
				code,
				name,
				type,
				city,
				area: area || undefined,
				address: address || undefined,
				phone: phone || undefined,
			}),
		onSuccess: async (data) => {
			toast.success(`Branch ${data.branch.code} created`)
			await queryClient.invalidateQueries({ queryKey: branchKeys.all })
			onOpenChange(false)
			resetForm()
		},
		onError: (error) => {
			if (error instanceof ApiError && error.status === 409) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function resetForm() {
		setName("")
		setType("RETAIL")
		setCity("")
		setArea("")
		setAddress("")
		setPhone("")
		setCode("")
		setCodeTouched(false)
		setFormError(null)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		createMutation.mutate()
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next)
				if (!next) resetForm()
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New branch</DialogTitle>
					<DialogDescription>
						The code is suggested from the city and area; adjust it before saving.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="branch-name">Name</Label>
						<Input
							id="branch-name"
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="branch-type">Type</Label>
							<Select value={type} onValueChange={(value) => setType(value as BranchType)}>
								<SelectTrigger id="branch-type" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="RETAIL">Retail</SelectItem>
									<SelectItem value="WAREHOUSE">Warehouse</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="branch-code">Code</Label>
							<Input
								id="branch-code"
								required
								className="font-mono"
								placeholder="ACC-SPX"
								value={code}
								onChange={(event) => {
									setCode(event.target.value.toUpperCase())
									setCodeTouched(true)
								}}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="branch-city">City</Label>
							<Input
								id="branch-city"
								required
								value={city}
								onChange={(event) => setCity(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="branch-area">Area</Label>
							<Input
								id="branch-area"
								value={area}
								onChange={(event) => setArea(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="branch-address">Address</Label>
						<Input
							id="branch-address"
							value={address}
							onChange={(event) => setAddress(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="branch-phone">Phone</Label>
						<Input
							id="branch-phone"
							value={phone}
							onChange={(event) => setPhone(event.target.value)}
						/>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? "Creating…" : "Create branch"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
