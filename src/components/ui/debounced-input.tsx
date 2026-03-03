'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface DebouncedInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange'> {
    value: string
    onChange: (value: string) => void
    debounceMs?: number
}

export function DebouncedInput({
    value: initialValue,
    onChange,
    debounceMs = 500,
    className,
    ...props
}: DebouncedInputProps) {
    const [value, setValue] = React.useState(initialValue)
    const [isFocused, setIsFocused] = React.useState(false)

    // Sync with external value ONLY when we aren't focused.
    // This prevents background polling from overwriting what the user is currently typing.
    React.useEffect(() => {
        if (!isFocused) {
            setValue(initialValue)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialValue])

    // Debounce the onChange callback
    React.useEffect(() => {
        if (!isFocused) return

        const timeout = setTimeout(() => {
            // Only fire change if it actually changed
            if (value !== initialValue) {
                onChange(value)
            }
        }, debounceMs)

        return () => clearTimeout(timeout)
    }, [value, isFocused, debounceMs, onChange, initialValue])

    return (
        <Input
            {...props}
            className={cn(className)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
                setIsFocused(true)
                props.onFocus?.(e)
            }}
            onBlur={(e) => {
                setIsFocused(false)
                // Ensure the final value gets saved immediately on blur (if the user typed fast and blurred before debounce)
                if (value !== initialValue) {
                    onChange(value)
                }
                props.onBlur?.(e)
            }}
        />
    )
}
