import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'sans-serif',
            letterSpacing: -0.5,
          }}
        >
          tf
        </span>
      </div>
    ),
    { ...size },
  )
}
