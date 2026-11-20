export function NycodeLogo({ compact = false }: { compact?: boolean }) {
	return (
		<svg className={`nycode-logo ${compact ? "compact" : ""}`} viewBox="0 0 4 4" role="img" aria-label="Nycode">
			<title>Nycode</title>
			<rect className="nycode-logo-coral" width="3" height="1" />
			<rect className="nycode-logo-coral" x="2" y="1" width="1" height="1" />
			<rect className="nycode-logo-blue" y="1" width="1" height="3" />
			<rect className="nycode-logo-blue" x="1" y="2" width="1" height="1" />
			<rect className="nycode-logo-yellow" x="3" y="2" width="1" height="2" />
		</svg>
	);
}
