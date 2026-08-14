import { listMediaFor, isMediaConfigured } from '@/lib/media'
import { MediaUpload } from './MediaUpload'
import { DeleteMediaButton } from './DeleteMediaButton'

// Drop-in gallery + uploader for any owner. Server component: lists existing
// media, then hands off to the client upload/delete controls. Degrades to a
// friendly notice while Blob storage isn't configured, so pages never break.
export async function MediaSection({
  ownerType, ownerId, tag, accept = 'image', label = 'photo', title, readOnly = false, enhance = false,
}: {
  ownerType: string; ownerId: string; tag?: string
  accept?: 'image' | 'video' | 'both' | 'document'; label?: string; title?: string; readOnly?: boolean
  /** C8 · offer the square-crop + levelling toggle. Before/after pairs only. */
  enhance?: boolean
}) {
  const [media, configured] = [await listMediaFor(ownerType, ownerId, tag), isMediaConfigured()]

  return (
    <div className="space-y-2">
      {title && <div className="cd-label">{title}</div>}
      <div className="flex flex-wrap gap-2">
        {media.map(m => (
          <div key={m.id} className="relative rounded-lg overflow-hidden"
            style={{ width: 96, height: 96, background: 'rgba(45,25,7,0.06)' }}>
            {/* Private store → served through the authenticated proxy, not the raw URL */}
            {m.kind === 'video'
              ? <video src={`/api/media/${m.id}/file`} className="w-full h-full object-cover" controls preload="metadata" />
              // A PDF has no thumbnail to show, so it gets a label that opens it
              // rather than an <img> that renders as a broken tile.
              : m.kind === 'document'
                ? <a href={`/api/media/${m.id}/file`} target="_blank" rel="noopener noreferrer"
                  className="w-full h-full flex flex-col items-center justify-center gap-1 text-xs font-semibold"
                  style={{ color: '#4a6265', background: 'rgba(114,144,148,0.14)' }}>
                  <span>PDF</span>
                  <span className="cd-muted font-normal">{m.createdAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}</span>
                </a>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={`/api/media/${m.id}/file`} alt={m.caption ?? ''} className="w-full h-full object-cover" />}
            {!readOnly && <DeleteMediaButton id={m.id} />}
          </div>
        ))}
        {media.length === 0 && (
          <div className="rounded-lg border border-dashed flex items-center justify-center text-xs cd-muted"
            style={{ width: 96, height: 96, borderColor: 'rgba(45,25,7,0.2)' }}>
            No {label}s yet
          </div>
        )}
      </div>
      {!readOnly && (configured
        ? <MediaUpload ownerType={ownerType} ownerId={ownerId} tag={tag} accept={accept} label={label} enhance={enhance} />
        : <p className="text-xs cd-muted">Photo/video storage isn’t set up yet — add the Vercel Blob token to enable uploads.</p>)}
    </div>
  )
}
