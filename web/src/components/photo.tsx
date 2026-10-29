/**
 * A local photograph in the two formats the build ships. Width and height are
 * always declared so the text never jumps while a photo loads (CLS).
 */
export function Photo({
	name,
	alt,
	width,
	height,
	className,
	priority = false,
}: {
	name: string
	alt: string
	width: number
	height: number
	className?: string
	priority?: boolean
}) {
	return (
		<picture>
			<source type="image/avif" srcSet={`/photos/${name}.avif`} />
			<source type="image/webp" srcSet={`/photos/${name}.webp`} />
			<img
				src={`/photos/${name}.webp`}
				alt={alt}
				width={width}
				height={height}
				loading={priority ? "eager" : "lazy"}
				decoding="async"
				className={className}
			/>
		</picture>
	)
}
