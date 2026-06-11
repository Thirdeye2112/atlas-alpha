import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import scannerRouter from "./scanner";
import watchlistRouter from "./watchlist";
import marketRouter from "./market";
import backtestRouter from "./backtest";
import cacheRouter from "./cache";
import researchRouter from "./research";
import { mlResearchRouter } from "./research-ml";
import { mlSignalRouter } from './research-signal';
import { patternStatsRouter } from './research-patterns';
import alertsRouter from "./alerts";
import botRouter from "./bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(scannerRouter);
router.use(watchlistRouter);
router.use(marketRouter);
router.use(backtestRouter);
router.use(cacheRouter);
router.use(researchRouter);
router.use('/research', mlResearchRouter);
router.use('/research', mlSignalRouter);
router.use('/research', patternStatsRouter);
router.use(alertsRouter);
router.use(botRouter);

export default router;
