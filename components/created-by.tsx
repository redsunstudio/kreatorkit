import { cn } from '@/lib/utils';
import { CREATED_BY_NAME, CREATED_BY_URL } from '@/lib/created-by';

/**
 * The KreatorKit byline. Clients meet this product on a login screen or a review
 * link with no other context, so the person behind it is named on every surface
 * they land on: auth pages, guest gates, the review page and the public post
 * preview.
 */
export { CREATED_BY_NAME, CREATED_BY_URL };

interface CreatedByProps {
  /** Extra classes — pass colours when the surface is not on the app theme. */
  className?: string;
  /** Wording before the name. */
  prefix?: string;
}

/** Block byline: a centred line for the bottom of a card or pane. */
export function CreatedBy({ className, prefix = 'Created by' }: CreatedByProps) {
  return (
    <p className={cn('text-center text-[11px] text-muted-foreground', className)}>
      {prefix} <CreatedByLink />
    </p>
  );
}

/** Inline byline: drops into an existing line of chrome (headers, meta rows). */
export function CreatedByInline({ className, prefix = 'Created by' }: CreatedByProps) {
  return (
    <span className={cn('text-xs text-muted-foreground whitespace-nowrap', className)}>
      {prefix} <CreatedByLink />
    </span>
  );
}

function CreatedByLink() {
  return (
    <a
      href={CREATED_BY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline-offset-2 hover:underline"
    >
      {CREATED_BY_NAME}
    </a>
  );
}
