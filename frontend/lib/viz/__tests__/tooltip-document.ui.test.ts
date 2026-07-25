import { createVegaTooltipHandler } from '../vega-tooltip-handler';
import { SharedTooltip } from '../shared-tooltip';

const fixture = () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  return { iframe, doc, container };
};

describe('chart tooltip document ownership', () => {
  afterEach(() => {
    document.querySelectorAll('#vg-tooltip-element, #mx-shared-tooltip, iframe').forEach(el => el.remove());
  });

  it('renders the shared tooltip in the chart document', () => {
    const { doc } = fixture();
    const tooltip = new SharedTooltip('light', doc);

    tooltip.show('<b>hello</b>', 100, 80);

    const el = doc.getElementById('mx-shared-tooltip')!;
    expect(el).toBeInTheDocument();
    expect(document.getElementById('mx-shared-tooltip')).toBeNull();
    expect(doc.getElementById('mx-viz-tooltip-styles')).toBeInTheDocument();
    expect(document.getElementById('mx-viz-tooltip-styles')).toBeNull();
    expect(el.style.left).toBe('116px');
    expect(el.style.top).toBe('96px');
  });

  it('renders Vega native tooltips in the chart document', () => {
    const { doc, container } = fixture();
    const handler = createVegaTooltipHandler(container, 'dark');
    const event = new MouseEvent('mousemove', { clientX: 120, clientY: 70 });

    handler({}, event, {}, { platform: 'ios', revenue: 1360000 });

    const el = doc.getElementById('vg-tooltip-element')!;
    expect(el).toBeInTheDocument();
    expect(document.getElementById('vg-tooltip-element')).toBeNull();
    expect(doc.getElementById('mx-viz-tooltip-styles')).toBeInTheDocument();
    expect(el.classList).toContain('dark-theme');
    expect(el.style.left).toBe('130px');
    expect(el.style.top).toBe('80px');
    expect(el.innerHTML).toContain('platform');
  });
});
