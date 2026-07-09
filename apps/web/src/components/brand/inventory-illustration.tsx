export function InventoryIllustration({ className = "w-full max-w-md" }: { className?: string }) {
  // Royal blue: #3A56E4 — used as the base tint for all elements on white background
  return (
    <svg
      viewBox="0 0 480 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-hidden="true"
    >
      {/* Shelf */}
      <rect x="40" y="248" width="400" height="10" rx="2" fill="#3A56E4" fillOpacity="0.28" />
      <rect x="40" y="258" width="400" height="4" rx="2" fill="#3A56E4" fillOpacity="0.14" />

      {/* Bottles on the shelf */}
      <g fillOpacity="0.9">
        {/* Bottle 1 */}
        <rect x="70" y="176" width="26" height="72" rx="4" fill="#3A56E4" fillOpacity="0.35" />
        <rect x="78" y="150" width="10" height="28" rx="3" fill="#3A56E4" fillOpacity="0.35" />
        <rect x="70" y="196" width="26" height="10" fill="#3A56E4" fillOpacity="0.22" />

        {/* Bottle 2 (taller, accent) */}
        <rect x="108" y="158" width="28" height="90" rx="4" fill="#3A56E4" fillOpacity="0.48" />
        <rect x="116" y="128" width="12" height="32" rx="3" fill="#3A56E4" fillOpacity="0.48" />
        <rect x="108" y="200" width="28" height="12" fill="#3A56E4" fillOpacity="0.28" />

        {/* Bottle 3 */}
        <rect x="148" y="188" width="24" height="60" rx="4" fill="#3A56E4" fillOpacity="0.32" />
        <rect x="155" y="164" width="10" height="26" rx="3" fill="#3A56E4" fillOpacity="0.32" />

        {/* Bottle 4 (short, accent) */}
        <rect x="184" y="204" width="26" height="44" rx="4" fill="#3A56E4" fillOpacity="0.42" />
        <rect x="192" y="182" width="10" height="24" rx="3" fill="#3A56E4" fillOpacity="0.42" />
      </g>

      {/* Crate, front-left */}
      <g>
        <rect x="52" y="290" width="94" height="70" rx="6" fill="#3A56E4" fillOpacity="0.14" />
        <rect x="52" y="290" width="94" height="70" rx="6" stroke="#3A56E4" strokeOpacity="0.4" strokeWidth="1" />
        <path d="M52 314H146" stroke="#3A56E4" strokeOpacity="0.32" strokeWidth="1" />
        <path d="M76 290V360" stroke="#3A56E4" strokeOpacity="0.32" strokeWidth="1" />
        <path d="M122 290V360" stroke="#3A56E4" strokeOpacity="0.32" strokeWidth="1" />
        {/* bottle necks peeking from crate */}
        <circle cx="64" cy="290" r="6" fill="#3A56E4" fillOpacity="0.38" />
        <circle cx="99" cy="290" r="6" fill="#3A56E4" fillOpacity="0.38" />
        <circle cx="134" cy="290" r="6" fill="#3A56E4" fillOpacity="0.38" />
      </g>

      {/* Stacked crate, back */}
      <g opacity="0.8">
        <rect x="150" y="300" width="70" height="52" rx="6" fill="#3A56E4" fillOpacity="0.10" />
        <rect x="150" y="300" width="70" height="52" rx="6" stroke="#3A56E4" strokeOpacity="0.35" strokeWidth="1" />
      </g>

      {/* Clipboard / count sheet — the "inventory" signature element */}
      <g>
        <rect x="252" y="150" width="150" height="192" rx="10" fill="white" fillOpacity="1" />
        <rect x="252" y="150" width="150" height="192" rx="10" stroke="#3A56E4" strokeOpacity="0.5" strokeWidth="1.5" />
        <rect x="296" y="140" width="62" height="20" rx="6" fill="white" stroke="#3A56E4" strokeOpacity="0.5" strokeWidth="1.5" />
        <rect x="304" y="146" width="46" height="8" rx="4" fill="#0B1B3A" fillOpacity="0.18" />

        {/* checklist rows */}
        <g>
          <rect x="272" y="182" width="14" height="14" rx="4" fill="#22C08A" />
          <path d="M275 189L279 193L285 183" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="296" y="185" width="86" height="8" rx="4" fill="#0B1B3A" fillOpacity="0.14" />
        </g>
        <g>
          <rect x="272" y="212" width="14" height="14" rx="4" fill="#22C08A" />
          <path d="M275 219L279 223L285 213" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="296" y="215" width="70" height="8" rx="4" fill="#0B1B3A" fillOpacity="0.14" />
        </g>
        <g>
          <rect x="272" y="242" width="14" height="14" rx="4" stroke="#3A56E4" strokeWidth="1.6" />
          <rect x="296" y="245" width="86" height="8" rx="4" fill="#0B1B3A" fillOpacity="0.14" />
        </g>
        <g>
          <rect x="272" y="272" width="14" height="14" rx="4" fill="white" stroke="#3A56E4" strokeOpacity="0.45" strokeWidth="1.6" />
          <rect x="296" y="275" width="58" height="8" rx="4" fill="#0B1B3A" fillOpacity="0.1" />
        </g>

        {/* divider + variance strip */}
        <path d="M272 302H382" stroke="#0B1B3A" strokeOpacity="0.1" strokeWidth="1" />
        <rect x="272" y="314" width="110" height="8" rx="4" fill="#0B1B3A" fillOpacity="0.1" />
        <rect x="272" y="300" width="0" height="0" />
      </g>

      {/* Floating accuracy badge, pinned to the clipboard's top-right corner */}
      <g>
        <circle cx="402" cy="164" r="28" fill="#3A56E4" />
        <path d="M391 164L398 171L413 154" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Ambient texture: soft squares, echoing brand geometry */}
      <g fill="#3A56E4" fillOpacity="0.12">
        <rect x="392" y="290" width="16" height="16" rx="3" />
        <rect x="416" y="312" width="24" height="24" rx="4" />
        <rect x="24" y="120" width="14" height="14" rx="3" />
        <rect x="392" y="60" width="20" height="20" rx="4" />
        <rect x="360" y="330" width="40" height="40" rx="6" />
        <rect x="8" y="60" width="30" height="30" rx="5" />
      </g>
    </svg>
  );
}
