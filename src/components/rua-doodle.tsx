export function RuaDoodle({ className = "", ariaHidden = true }: { className?: string; ariaHidden?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 171 168" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden ? "true" : undefined} focusable="false">
      <circle cx="85.5" cy="83.5" r="80" />
      <circle cx="85.5" cy="83.5" r="73" />
      <path d="M85.5 10.5 V46" />
      <path d="M70 52 L32.5 30.5 M101 52 L138.5 30.5" />
      <path d="M31 96 L10.5 83.5 M140 96 L160.5 83.5" />
      <path d="M49 106.5 C40 106 33 103 31 98 C29 93 34 84 45 74 C62 58 77 47 85.5 46 C94 47 109 58 126 74 C137 84 142 93 140 98 C138 103 131 106 122 106.5" />
      <path d="M85.5 46 V80 M85.5 46 C80 56 73 68 62 78 M85.5 46 C91 56 98 68 109 78" />
      <path d="M49 106.5 V131.5 M122 106.5 V131.5" />
      <path d="M27 131.5 H144" />
      <path d="M73.5 131.5 V110 C73.5 102.5 78.5 97.5 85.5 97.5 C92.5 97.5 97.5 102.5 97.5 110 V131.5" />
      <path d="M73.5 131.5 L55 154 M97.5 131.5 L116 154" />
    </svg>
  );
}
