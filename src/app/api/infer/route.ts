import { NextRequest, NextResponse } from 'next/server';
import { runInference } from '@/lib/bayesian';
import { structureReport } from '@/lib/spuq';
import { ActionClass, Hypothesis } from '@/types';
import hypothesesData from '@/data/hypotheses.json';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actions, rawReports } = body;

    let structuredActions: ActionClass[] = [];

    // 이미 정형화된 액션이 있으면 사용
    if (actions && actions.length > 0) {
      structuredActions = actions;
    }

    // Raw 보고서가 있으면 SPUQ로 정형화
    if (rawReports && rawReports.length > 0) {
      for (const report of rawReports) {
        const action = structureReport(
          report.text,
          report.id || `report-${Date.now()}`,
          report.source || 'unknown',
          report.analystConfidence || 0.7,
          report.timestamp
        );
        structuredActions.push(action);
      }
    }

    // 베이지안 추론 실행
    const hypotheses = hypothesesData as unknown as Hypothesis[];
    const result = runInference(structuredActions, hypotheses);

    return NextResponse.json({
      inference: result,
      structuredActions,
    });
  } catch (error) {
    console.error('Inference API error:', error);
    return NextResponse.json(
      { error: 'Failed to run inference' },
      { status: 500 }
    );
  }
}
