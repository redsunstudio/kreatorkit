'use client';

import { memo } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type {
  BunnyDownloadPreference,
  DownloadTarget,
  Version,
} from '@/components/video-page/types';

interface DownloadControlsProps {
  activeVersion: Version | null | undefined;
  videoCanDownload: boolean;
  isDownloading: boolean;
  activeDownloadTarget: DownloadTarget | null;
  onDownload: (preference?: BunnyDownloadPreference, proxyHeight?: number) => void;
  compact?: boolean;
}

interface DownloadMenuItemsProps {
  activeVersion: Version | null | undefined;
  videoCanDownload: boolean;
  isDownloading: boolean;
  activeDownloadTarget: DownloadTarget | null;
  onDownload: (preference?: BunnyDownloadPreference, proxyHeight?: number) => void;
}

/** "4K proxy" / "1080p proxy" — the label John asked for on every download choice. */
function proxyLabel(height: number): string {
  return height >= 2160 ? '4K proxy' : `${height}p proxy`;
}

/**
 * Quality choices for a cut we host ourselves: the untouched master first, then
 * every proxy rendition the transcode worker has finished. Renditions still
 * encoding simply aren't listed yet.
 */
function R2DownloadItems({
  activeVersion,
  disabled,
  isDownloading,
  onDownload,
}: {
  activeVersion: Version;
  disabled: boolean;
  isDownloading: boolean;
  onDownload: (preference?: BunnyDownloadPreference, proxyHeight?: number) => void;
}) {
  const proxies = activeVersion.proxies ?? [];
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onDownload(undefined, undefined);
        }}
        disabled={disabled}
      >
        {isDownloading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-2" />
        )}
        Original file
      </DropdownMenuItem>
      {proxies.map((proxy) => (
        <DropdownMenuItem
          key={proxy.id}
          onSelect={(event) => {
            event.preventDefault();
            onDownload(undefined, proxy.height);
          }}
          disabled={disabled}
        >
          <Download className="h-4 w-4 mr-2" />
          {proxyLabel(proxy.height)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export const DownloadControls = memo(function DownloadControls({
  activeVersion,
  videoCanDownload,
  isDownloading,
  activeDownloadTarget,
  onDownload,
  compact = false,
}: DownloadControlsProps) {
  if (!activeVersion) return null;

  const isVideoDownloadAvailable =
    videoCanDownload &&
    (activeVersion.providerId === 'bunny' ||
      activeVersion.providerId === 'direct' ||
      activeVersion.providerId === 'r2');

  if (activeVersion.providerId === 'bunny') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={compact ? 'icon' : 'sm'}
            className={cn(
              compact && 'h-8 w-8',
              'transition-opacity duration-300',
              isDownloading && 'opacity-50 pointer-events-none'
            )}
            disabled={!isVideoDownloadAvailable || isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className={cn('h-4 w-4', !compact && 'mr-1')} />
            )}
            {!compact && (
              <>
                Download
                <ChevronDown className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onDownload('original');
            }}
            disabled={!isVideoDownloadAvailable || isDownloading}
          >
            {activeDownloadTarget === 'original' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download Original
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onDownload('compressed');
            }}
            disabled={!isVideoDownloadAvailable || isDownloading}
          >
            {activeDownloadTarget === 'compressed' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download Compressed
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (compact || activeVersion.providerId === 'r2') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={compact ? 'icon' : 'sm'}
            className={cn(
              compact && 'h-8 w-8',
              'transition-opacity duration-300',
              isDownloading && 'opacity-50 pointer-events-none'
            )}
            disabled={!isVideoDownloadAvailable || isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className={cn('h-4 w-4', !compact && 'mr-1')} />
            )}
            {!compact && (
              <>
                Download
                <ChevronDown className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {activeVersion.providerId === 'r2' ? (
            <R2DownloadItems
              activeVersion={activeVersion}
              disabled={!isVideoDownloadAvailable || isDownloading}
              isDownloading={isDownloading}
              onDownload={onDownload}
            />
          ) : (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onDownload();
              }}
              disabled={!isVideoDownloadAvailable || isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Download
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        'transition-opacity duration-300',
        isDownloading && 'opacity-50 pointer-events-none'
      )}
      onClick={() => onDownload()}
      disabled={!isVideoDownloadAvailable || isDownloading}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-1" />
      )}
      Download
    </Button>
  );
});

export const DownloadMenuItems = memo(function DownloadMenuItems({
  activeVersion,
  videoCanDownload,
  isDownloading,
  activeDownloadTarget,
  onDownload,
}: DownloadMenuItemsProps) {
  if (!activeVersion) return null;

  const isVideoDownloadAvailable =
    videoCanDownload &&
    (activeVersion.providerId === 'bunny' ||
      activeVersion.providerId === 'direct' ||
      activeVersion.providerId === 'r2');

  if (activeVersion.providerId === 'bunny') {
    return (
      <>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onDownload('original');
          }}
          disabled={!isVideoDownloadAvailable || isDownloading}
        >
          {activeDownloadTarget === 'original' ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Download Original
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onDownload('compressed');
          }}
          disabled={!isVideoDownloadAvailable || isDownloading}
        >
          {activeDownloadTarget === 'compressed' ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Download Compressed
        </DropdownMenuItem>
      </>
    );
  }

  if (activeVersion.providerId === 'r2') {
    return (
      <R2DownloadItems
        activeVersion={activeVersion}
        disabled={!isVideoDownloadAvailable || isDownloading}
        isDownloading={isDownloading}
        onDownload={onDownload}
      />
    );
  }

  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onDownload();
      }}
      disabled={!isVideoDownloadAvailable || isDownloading}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      Download
    </DropdownMenuItem>
  );
});
