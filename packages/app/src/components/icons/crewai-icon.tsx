import Svg, { Circle, Path } from "react-native-svg";

interface CrewAIIconProps {
  size?: number;
  color?: string;
}

export function CrewAIIcon({ size = 16, color = "currentColor" }: CrewAIIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={8} cy={8} r={3} fill={color} />
      <Circle cx={16} cy={8} r={3} fill={color} />
      <Circle cx={12} cy={16} r={3} fill={color} />
      <Path d="M8 11v2l4 3M16 11v2l-4 3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}
