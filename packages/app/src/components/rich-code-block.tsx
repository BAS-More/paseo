import { useState, useMemo, useCallback, memo } from "react";
import { View, Text, Platform, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

const isWeb = Platform.OS === "web";
const CLOSE_SCRIPT = "\x3c/script>";

const IFRAME_STYLE: React.CSSProperties = { border: "none", width: "100%", minHeight: 200 };
const IFRAME_STYLE_INLINE: React.CSSProperties = { border: "none", width: "100%", minHeight: 24 };
const IFRAME_STYLE_BLOCK: React.CSSProperties = { border: "none", width: "100%", minHeight: 60 };

interface MermaidBlockProps {
  code: string;
}

export const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const [error, setError] = useState<string | null>(null);

  if (isWeb) {
    return <WebMermaidBlock code={code} onError={setError} error={error} />;
  }
  return (
    <View style={richStyles.fallbackContainer}>
      <Text style={richStyles.fallbackLabel}>Mermaid Diagram</Text>
      <Text style={richStyles.fallbackCode}>{code}</Text>
    </View>
  );
});

function WebMermaidBlock({
  code,
  error,
  onError,
}: {
  code: string;
  error: string | null;
  onError: (err: string | null) => void;
}) {
  const html = useMemo(
    () =>
      `<!DOCTYPE html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js">${CLOSE_SCRIPT}
<style>body{margin:0;background:transparent;display:flex;justify-content:center;}</style>
</head><body>
<pre class="mermaid">${escapeHtml(code)}</pre>
<script>
mermaid.initialize({startOnLoad:true,theme:'neutral'});
mermaid.run().catch(function(e){
  document.body.innerHTML='<pre style="color:red">'+e.message+'</pre>';
});
${CLOSE_SCRIPT}
</body></html>`,
    [code],
  );

  const handleError = useCallback(() => onError("Failed to render diagram"), [onError]);

  if (error) {
    return (
      <View style={richStyles.fallbackContainer}>
        <Text style={richStyles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={richStyles.container}>
      <iframe
        srcDoc={html}
        style={IFRAME_STYLE}
        sandbox="allow-scripts"
        title="Mermaid diagram"
        onError={handleError}
      />
    </View>
  );
}

interface LatexBlockProps {
  code: string;
  inline?: boolean;
}

export const LatexBlock = memo(function LatexBlock({ code, inline = false }: LatexBlockProps) {
  if (isWeb) {
    return <WebLatexBlock code={code} inline={inline} />;
  }
  return (
    <View style={inline ? undefined : richStyles.fallbackContainer}>
      <Text style={richStyles.fallbackCode}>{code}</Text>
    </View>
  );
});

function WebLatexBlock({ code, inline }: { code: string; inline: boolean }) {
  const html = useMemo(
    () =>
      `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js">${CLOSE_SCRIPT}
<style>body{margin:0;background:transparent;display:${inline ? "inline" : "flex"};justify-content:center;}</style>
</head><body>
<span id="math"></span>
<script>
try{
  katex.render(${JSON.stringify(code)},document.getElementById('math'),{displayMode:${!inline},throwOnError:false});
}catch(e){
  document.getElementById('math').textContent=e.message;
}
${CLOSE_SCRIPT}
</body></html>`,
    [code, inline],
  );

  const containerStyle: ViewStyle = inline ? richStyles.inlineContainer : richStyles.container;
  const iframeStyle = inline ? IFRAME_STYLE_INLINE : IFRAME_STYLE_BLOCK;

  return (
    <View style={containerStyle}>
      <iframe srcDoc={html} style={iframeStyle} sandbox="allow-scripts" title="Math expression" />
    </View>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const richStyles = StyleSheet.create((theme: Theme) => ({
  container: {
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    marginVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  inlineContainer: {
    overflow: "hidden",
  },
  fallbackContainer: {
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[3],
    marginVertical: theme.spacing[2],
  },
  fallbackLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[1],
  },
  fallbackCode: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontFamily: "monospace",
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
