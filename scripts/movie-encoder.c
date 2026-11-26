#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>

#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>

EM_JS(int, write_output, (const uint8_t *data, int length), {
    return Module['writeOutput'](data, length);
});

EM_JS(double, seek_output, (double offset, int whence), {
    return Module['seekOutput'](offset, whence);
});

static AVFormatContext *movie;
static AVCodecContext *encoder;
static AVIOContext *output;
static AVFrame *frame;
static AVPacket *packet;
static uint8_t *input;
static float transfer[256];
static int64_t next_pts;

static int write_packet(void *opaque, const uint8_t *data, int length) {
    return write_output(data, length);
}

static int64_t seek_packet(void *opaque, int64_t offset, int whence) {
    return (int64_t)seek_output((double)offset, whence);
}

EMSCRIPTEN_KEEPALIVE const char *movie_error(int code) {
    static char message[AV_ERROR_MAX_STRING_SIZE];
    return av_make_error_string(message, sizeof(message), code);
}

EMSCRIPTEN_KEEPALIVE int movie_open(int width, int height, int fps, int cineform) {
    const AVCodec *codec = avcodec_find_encoder_by_name(cineform ? "cfhd" : "prores_ks");
    if (!codec) return AVERROR_ENCODER_NOT_FOUND;
    int result = avformat_alloc_output_context2(&movie, NULL, "mov", NULL);
    if (result < 0) return result;

    encoder = avcodec_alloc_context3(codec);
    AVStream *stream = avformat_new_stream(movie, NULL);
    uint8_t *buffer = av_malloc(65536);
    if (!encoder || !stream || !buffer) {
        av_free(buffer);
        return AVERROR(ENOMEM);
    }
    output = avio_alloc_context(buffer, 65536, 1, NULL, NULL, write_packet, seek_packet);
    if (!output) {
        av_free(buffer);
        return AVERROR(ENOMEM);
    }
    movie->pb = output;
    movie->flags |= AVFMT_FLAG_CUSTOM_IO;
    encoder->width = width;
    encoder->height = height;
    encoder->pix_fmt = AV_PIX_FMT_YUV422P10LE;
    encoder->time_base = (AVRational){1, fps};
    encoder->framerate = (AVRational){fps, 1};
    encoder->thread_count = 1;
    encoder->color_primaries = AVCOL_PRI_BT709;
    encoder->color_trc = AVCOL_TRC_BT709;
    encoder->colorspace = AVCOL_SPC_BT709;
    encoder->color_range = AVCOL_RANGE_MPEG;
    if (cineform) av_opt_set(encoder->priv_data, "quality", "high", 0);
    else av_opt_set(encoder->priv_data, "profile", "standard", 0);
    result = avcodec_open2(encoder, codec, NULL);
    if (result < 0) return result;
    stream->time_base = encoder->time_base;
    stream->avg_frame_rate = encoder->framerate;
    result = avcodec_parameters_from_context(stream->codecpar, encoder);
    if (result < 0) return result;

    frame = av_frame_alloc();
    packet = av_packet_alloc();
    input = av_malloc((size_t)width * height * 4);
    if (!frame || !packet || !input) return AVERROR(ENOMEM);
    frame->width = width;
    frame->height = height;
    frame->format = encoder->pix_fmt;
    frame->color_range = encoder->color_range;
    frame->color_primaries = encoder->color_primaries;
    frame->color_trc = encoder->color_trc;
    frame->colorspace = encoder->colorspace;
    result = av_frame_get_buffer(frame, 32);
    if (result < 0) return result;

    for (int i = 0; i < 256; i++) {
        float srgb = i / 255.0f;
        float linear = srgb <= 0.04045f ? srgb / 12.92f : powf((srgb + 0.055f) / 1.055f, 2.4f);
        transfer[i] = linear < 0.018f ? 4.5f * linear : 1.099f * powf(linear, 0.45f) - 0.099f;
    }
    AVDictionary *options = NULL;
    av_dict_set(&options, "movflags", "write_colr", 0);
    result = avformat_write_header(movie, &options);
    av_dict_free(&options);
    return result;
}

EMSCRIPTEN_KEEPALIVE uint8_t *movie_input(void) {
    return input;
}

static int encode(AVFrame *image) {
    int result = avcodec_send_frame(encoder, image);
    if (result < 0) return result;
    while ((result = avcodec_receive_packet(encoder, packet)) >= 0) {
        av_packet_rescale_ts(packet, encoder->time_base, movie->streams[0]->time_base);
        if (!packet->duration) packet->duration = av_rescale_q(1, encoder->time_base, movie->streams[0]->time_base);
        result = av_interleaved_write_frame(movie, packet);
        if (result < 0) return result;
    }
    return result == AVERROR(EAGAIN) || result == AVERROR_EOF ? 0 : result;
}

EMSCRIPTEN_KEEPALIVE int movie_push(void) {
    int result = av_frame_make_writable(frame);
    if (result < 0) return result;
    const uint8_t *pixel = input;
    for (int y = 0; y < frame->height; y++) {
        uint16_t *luma = (uint16_t *)(frame->data[0] + y * frame->linesize[0]);
        uint16_t *cb = (uint16_t *)(frame->data[1] + y * frame->linesize[1]);
        uint16_t *cr = (uint16_t *)(frame->data[2] + y * frame->linesize[2]);
        for (int x = 0; x < frame->width; x += 2) {
            float sum_cb = 0, sum_cr = 0;
            for (int sample = 0; sample < 2; sample++, pixel += 4) {
                const float r = transfer[pixel[0]], g = transfer[pixel[1]], b = transfer[pixel[2]];
                const float l = 0.2126f * r + 0.7152f * g + 0.0722f * b;
                luma[x + sample] = (uint16_t)(64.5f + 876.0f * l);
                sum_cb += (b - l) / 1.8556f;
                sum_cr += (r - l) / 1.5748f;
            }
            cb[x / 2] = (uint16_t)(512.5f + 448.0f * sum_cb);
            cr[x / 2] = (uint16_t)(512.5f + 448.0f * sum_cr);
        }
    }
    frame->pts = next_pts++;
    return encode(frame);
}

EMSCRIPTEN_KEEPALIVE int movie_finish(void) {
    int result = encode(NULL);
    if (result >= 0) result = av_write_trailer(movie);
    avio_flush(output);
    return result < 0 ? result : output->error;
}
