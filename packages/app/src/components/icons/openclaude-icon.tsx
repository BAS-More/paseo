import Svg, { Path } from "react-native-svg";

interface OpenClaudeIconProps {
  size?: number;
  color?: string;
}

export function OpenClaudeIcon({ size = 16, color = "currentColor" }: OpenClaudeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18L18.36 7.5 12 10.82 5.64 7.5 12 4.18zM5 9.06l6 3.32v6.56l-6-3.32V9.06zm14 0v6.56l-6 3.32v-6.56l6-3.32z"
        fill={color}
      />
    </Svg>
  );
}
