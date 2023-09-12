import React from 'react';
import fs from 'fs';
import path from 'path';

import templateMapper from '../../templates';
import ServiceNames from '../../common/service-names';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';

export function getHeaderandFooterTemplates({
  service,
  template,
}: {
  service: ServiceNames;
  template: string;
}): {
  headerTemplate: string;
  footerTemplate: string;
} {
  const { header: HeaderTemplateNode, footer: FooterTemplateNode } =
    templateMapper?.[service]?.[template] || {};

  const root = process.cwd();
  const headerBase = fs.readFileSync(
    path.resolve(root, 'public/templates/header-template.html'),
    { encoding: 'utf-8' }
  );

  const footerBase = fs.readFileSync(
    path.resolve(root, 'public/templates/footer-template.html'),
    { encoding: 'utf-8' }
  );

  return {
    headerTemplate: headerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<HeaderTemplateNode />)
    ),
    footerTemplate: footerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<FooterTemplateNode />)
    ),
  };
}

function renderTemplate(
  templateConfig: {
    service: ServiceNames;
    template: string;
  },
  templateData: Record<string, unknown>
) {
  const Node: React.ComponentType<any> =
    templateMapper?.[templateConfig.service]?.[templateConfig.template]
      .template;
  if (typeof Node === 'undefined') {
    throw `Template not found, invalid query: ${templateConfig.service}: ${templateConfig.template}!`;
  }

  const root = process.cwd();
  const baseTemplate = fs.readFileSync(
    path.resolve(root, 'public/templates/base-template.html'),
    { encoding: 'utf-8' }
  );

  const template = baseTemplate.replace(
    '<div id="root"></div>',
    `<div id="root">${renderToString(<Node {...templateData} />)}</div>`
  );
  return template;
}

export default renderTemplate;
