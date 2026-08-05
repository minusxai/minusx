import StandaloneContextPage from '@/components/context/StandaloneContextPage';

interface SkillsPageProps {
  searchParams: Promise<{ context?: string }>;
}

export default async function SkillsPage({ searchParams }: SkillsPageProps) {
  const { context } = await searchParams;
  return <StandaloneContextPage surface="skills" requestedContextId={context} />;
}
