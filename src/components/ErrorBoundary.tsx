// components/ErrorBoundary.tsx
import type { ReactNode } from 'react'
import { Component } from "react"
import { translations, type Language } from "@/lib/i18n/translations"

interface Props {
    children: ReactNode
    fallback?: ReactNode
}

interface State {
    hasError: boolean
    error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo)
    }

    render() {
        if (this.state.hasError) {
            const language: Language = typeof document !== "undefined" && document.documentElement.lang.startsWith("ar") ? "ar" : "en"
            return this.props.fallback || (
                <div className="p-4 text-red-500">
                    <h2>{translations[language]["common.somethingWentWrong"]}</h2>
                    <pre>{this.state.error?.message}</pre>
                </div>
            )
        }
        return this.props.children
    }
}
