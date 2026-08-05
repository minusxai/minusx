import StandaloneContextPage from '@/components/context/StandaloneContextPage';

interface AgentsPageProps {
  searchParams: Promise<{ context?: string }>;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const { context } = await searchParams;
  return <StandaloneContextPage surface="agents" requestedContextId={context} />;
}
