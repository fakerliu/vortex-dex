import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PreferencesService } from './preferences.service';
import type {
  FavoriteTokenDto,
  UpdatePreferenceRequestDto,
  UserPreferenceDto,
} from './preferences.types';

/**
 * 用户偏好模块 API（挂 /api/v1 前缀，路由为 /api/v1/preferences/*）。
 * 供前端 /settings 页与 Swap 页读取默认滑点 / 收藏列表。
 */
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  // GET /api/v1/preferences/:address
  @Get(':address')
  getPreference(@Param('address') address: string): Promise<UserPreferenceDto> {
    return this.preferencesService.getPreference(address);
  }

  // PUT /api/v1/preferences/:address
  @Put(':address')
  updatePreference(
    @Param('address') address: string,
    @Body() req: UpdatePreferenceRequestDto,
  ): Promise<UserPreferenceDto> {
    return this.preferencesService.updatePreference(address, req);
  }

  // POST /api/v1/preferences/:address/favorites
  @Post(':address/favorites')
  addFavorite(
    @Param('address') address: string,
    @Body() fav: FavoriteTokenDto,
  ): Promise<UserPreferenceDto> {
    return this.preferencesService.addFavorite(address, fav);
  }

  // DELETE /api/v1/preferences/:address/favorites/:tokenAddress?chainId=
  @Delete(':address/favorites/:tokenAddress')
  removeFavorite(
    @Param('address') address: string,
    @Param('tokenAddress') tokenAddress: string,
    @Query('chainId') chainId: string,
  ): Promise<UserPreferenceDto> {
    return this.preferencesService.removeFavorite(
      address,
      tokenAddress,
      Number(chainId),
    );
  }
}
