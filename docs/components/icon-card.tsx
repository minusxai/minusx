import { Card, Cards } from 'fumadocs-ui/components/card';
import {
  ScanSearch,
  LayoutDashboard,
  BookText,
  MessageCircle,
  Download,
  Lightbulb,
  GraduationCap,
  Bell,
  FileText,
  Database,
  Rocket,
} from 'lucide-react';
import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  question: <ScanSearch />,
  dashboard: <LayoutDashboard />,
  'knowledge-base': <BookText />,
  'ai-chat': <MessageCircle />,
  installation: <Download />,
  concepts: <Lightbulb />,
  guides: <GraduationCap />,
  proactive: <Bell />,
  reports: <FileText />,
  alerts: <Bell />,
  connection: <Database />,
  explore: <Rocket />,
};

interface IconCardProps {
  icon: string;
  title: string;
  description: string;
  href: string;
}

export function IconCard({ icon, title, description, href }: IconCardProps) {
  return <Card icon={icons[icon]} title={title} description={description} href={href} />;
}

export { Cards };
