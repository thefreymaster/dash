/**
 * A gradient layer that cross-fades between a day and a night version when the theme
 * flips. `background-image` cannot transition, so two layers swap opacity instead (as the
 * mockup's `.atmo.day` / `.atmo.night` do).
 */
import { Box, type BoxProps } from '@chakra-ui/react';

export function ThemeCrossfade({
  day,
  night,
  ...rest
}: { day: string; night: string } & Omit<BoxProps, 'bgImage'>) {
  return (
    <>
      <Box
        aria-hidden
        position="absolute"
        inset="0"
        pointerEvents="none"
        bgImage={day}
        opacity={1}
        _dark={{ opacity: 0 }}
        transitionProperty="opacity"
        transitionDuration="theme"
        {...rest}
      />
      <Box
        aria-hidden
        position="absolute"
        inset="0"
        pointerEvents="none"
        bgImage={night}
        opacity={0}
        _dark={{ opacity: 1 }}
        transitionProperty="opacity"
        transitionDuration="theme"
        {...rest}
      />
    </>
  );
}
