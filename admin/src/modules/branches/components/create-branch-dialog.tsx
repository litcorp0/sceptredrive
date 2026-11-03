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
import type { BranchCreateInput, BranchType } from "../types"
import { LATITUDE_BOUNDS, LONGITUDE_BOUNDS, parseCoordinate } from "../utils/coordinates"

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
	const [latitude, setLatitude] = useState("")
	const [longitude, setLongitude] = useState("")
	const [preview, setPreview] = useState<{ code: string; adjusted: boolean } | null>(null)
	const [formError, setFormError] = useState<string | null>(null)

	const debouncedCity = useDebouncedValue(city, 400)
	const debouncedArea = useDebouncedValue(area, 400)

	useEffect(() => {
		if (debouncedCity.trim().length === 0) {
			setPreview(null)
			return
		}
		let cancelled = false
		void suggestBranchCode({ city: debouncedCity, area: debouncedArea || undefined, type })
			.then((suggestion) => {
				if (!cancelled) setPreview(suggestion)
			})
			.catch(() => {
				if (!cancelled) setPreview(null)
			})
		return () => {
			cancelled = true
		}
	}, [debouncedCity, debouncedArea, type])

	const createMutation = useMutation({
		mutationFn: (input: BranchCreateInput) => createBranch(input),
		onSuccess: async (data) => {
			toast.success(`Branch ${data.branch.name} (${data.branch.code}) created`)
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
		setLatitude("")
		setLongitude("")
		setPreview(null)
		setFormError(null)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		let parsedLatitude: number | undefined
		let parsedLongitude: number | undefined
		try {
			parsedLatitude = parseCoordinate(latitude, LATITUDE_BOUNDS, "Latitude")
			parsedLongitude = parseCoordinate(longitude, LONGITUDE_BOUNDS, "Longitude")
		} catch (error) {
			setFormError(error instanceof Error ? error.message : "Invalid coordinates")
			return
		}

		createMutation.mutate({
			name,
			type,
			city,
			area: area || undefined,
			address: address || undefined,
			phone: phone || undefined,
			latitude: parsedLatitude,
			longitude: parsedLongitude,
		})
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
						The branch code is generated from the type, city and area. A suffix is added if it is
						already taken.
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
							<Label htmlFor="branch-city">City</Label>
							<Input
								id="branch-city"
								required
								value={city}
								onChange={(event) => setCity(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="branch-area">Area</Label>
							<Input
								id="branch-area"
								value={area}
								onChange={(event) => setArea(event.target.value)}
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
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="branch-address">Address</Label>
						<Input
							id="branch-address"
							value={address}
							onChange={(event) => setAddress(event.target.value)}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="branch-latitude">Latitude</Label>
							<Input
								id="branch-latitude"
								inputMode="decimal"
								placeholder="5.6037"
								value={latitude}
								onChange={(event) => setLatitude(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="branch-longitude">Longitude</Label>
							<Input
								id="branch-longitude"
								inputMode="decimal"
								placeholder="-0.1870"
								value={longitude}
								onChange={(event) => setLongitude(event.target.value)}
							/>
						</div>
					</div>
					<p className="-mt-2 text-xs text-muted-foreground">
						Right-click the counter on Google Maps and copy the two numbers. They make the public
						site's Directions link land at the door instead of searching the road name.
					</p>

					<div className="grid gap-1.5">
						<span className="text-sm font-medium">Branch code</span>
						<p
							aria-live="polite"
							className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm"
						>
							{preview?.code ??
								(city.trim() ? "Will be assigned on save" : "Enter a city to preview")}
						</p>
						<p className="text-xs text-muted-foreground">
							Assigned when you save. A suffix is added if the code is already taken.
						</p>
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
